import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonReadOptions<T> {
  optional?: boolean;
  label?: string;
  validate?: (value: unknown) => value is T;
}

/** Missing optional state is allowed; corrupt state is never treated as empty. */
export async function readJsonStrict<T>(path: string, options: JsonReadOptions<T> = {}): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (options.optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`无法读取${options.label ?? "JSON 状态"}：${path}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${options.label ?? "JSON 状态"}已损坏，已停止发布且保留上一版：${path}`, { cause: error });
  }
  if (options.validate && !options.validate(value)) {
    throw new Error(`${options.label ?? "JSON 状态"}结构不合法，已停止发布且保留上一版：${path}`);
  }
  return value as T;
}

export const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const isArray = <T = unknown>(value: unknown): value is T[] => Array.isArray(value);

interface StagedFile { path: string; content: string; }

/**
 * Best-effort multi-file transaction. Every file is fully written first; only
 * then are targets swapped. If a swap fails, already-swapped files roll back.
 */
export class FileTransaction {
  private readonly files = new Map<string, StagedFile>();
  constructor(private readonly id = `${process.pid}-${Date.now()}`, private readonly testHooks: { failAfterSwaps?: number } = {}) {}

  stage(path: string, content: string): void {
    this.files.set(path, { path, content });
  }

  get size(): number { return this.files.size; }

  async commit(): Promise<void> {
    const prepared: Array<StagedFile & { temp: string; backup: string; existed: boolean }> = [];
    const swapped: typeof prepared = [];
    try {
      for (const file of this.files.values()) {
        await mkdir(dirname(file.path), { recursive: true });
        const temp = `${file.path}.tmp-${this.id}`;
        const backup = `${file.path}.bak-${this.id}`;
        await writeFile(temp, file.content, "utf8");
        let existed = true;
        try { await access(file.path); } catch { existed = false; }
        prepared.push({ ...file, temp, backup, existed });
      }
      for (const file of prepared) {
        if (file.existed) await rename(file.path, file.backup);
        try {
          await rename(file.temp, file.path);
          swapped.push(file);
        } catch (error) {
          if (file.existed) await rename(file.backup, file.path).catch(() => undefined);
          throw error;
        }
        if (this.testHooks.failAfterSwaps === swapped.length) throw new Error("injected transaction failure");
      }
      await Promise.all(prepared.filter((file) => file.existed).map((file) => unlink(file.backup).catch(() => undefined)));
    } catch (error) {
      for (const file of [...swapped].reverse()) {
        await unlink(file.path).catch(() => undefined);
        if (file.existed) await rename(file.backup, file.path).catch(() => undefined);
      }
      await Promise.all(prepared.flatMap((file) => [unlink(file.temp).catch(() => undefined), unlink(file.backup).catch(() => undefined)]));
      throw new Error("输出事务提交失败；已回滚并保留上一版公开内容。", { cause: error });
    }
  }
}
