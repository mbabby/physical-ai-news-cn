const CHINESE_SUBJECT = /(?:融资|部署|代码|客户|数据集|(?:模型)?权重|投资方|估值|轮次|监管(?:文件|披露|申报)?|产品发布日期|部署地点|部署规模|作者机构|实验室机构|真实机器人实验)/;
const CHINESE_ABSENCE_CUE = /(?:暂未|尚未|仍未|迄今未|尚无|暂无|没有|不存在|缺少|缺乏|未(?:发现|找到|见到|获得|公开|发布|提供|进行|曾|披露|确认|验证)?)/;
const CHINESE_ABSENCE = new RegExp(
  `(?:未|无)(?:融资|部署|代码)|${CHINESE_ABSENCE_CUE.source}[^，。；\\n]{0,16}${CHINESE_SUBJECT.source}|${CHINESE_SUBJECT.source}[^，。；\\n]{0,16}${CHINESE_ABSENCE_CUE.source}(?:发生|完成|存在|发布|公开|提供|落地|实现|进行|找到|发现|确认|验证)?`,
  "i",
);
const ENGLISH_SUBJECT = /(?:funding|financ(?:ing|ed)?|deploy(?:ment|ed)?|code|customers?|datasets?|(?:model\s+)?weights?|investors?|valuation|funding\s+round|regulatory\s+filing|release\s+date|institutions?|real[- ]robot\s+(?:experiment|evidence))/;
const ENGLISH_ABSENCE_CUE = /(?:no|without|not|never|lack(?:s|ed|ing)?|absence|absent|unavailable|missing|(?:has|have|had|is|are|was|were|does|do|did)n['’]t)/;
const ENGLISH_ABSENCE = new RegExp(
  `\\b${ENGLISH_ABSENCE_CUE.source}\\b.{0,60}\\b${ENGLISH_SUBJECT.source}\\b|\\b${ENGLISH_SUBJECT.source}\\b.{0,60}\\b${ENGLISH_ABSENCE_CUE.source}\\b`,
  "i",
);

/** Reject prose that turns an unresolved public evidence gap into a negative fact. */
export function hasUnsupportedNegativeUnknown(values: readonly string[]): boolean {
  return values.some((value) => CHINESE_ABSENCE.test(value) || ENGLISH_ABSENCE.test(value));
}
