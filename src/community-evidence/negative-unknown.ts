const CHINESE_SUBJECT = /(?:公司(?:官方)?名称|官方名称|公司官网|官方网站|官网|融资(?:轮次|金额|估值|监管(?:文件|披露|申报))?|投资方|监管(?:文件|披露|申报)|产品(?:官方)?页面|产品官网|产品发布日期|发布日期|部署(?:信息|客户|地点|规模)?|客户(?:证据)?|代码(?:仓库)?|数据集|(?:模型)?权重|真实机器人(?:实验|证据)|作者机构|实验室机构|研究机构)/;
const CHINESE_ABSENCE_CUE = /(?:暂未|尚未|仍未|迄今未|尚无|暂无|没有|不存在|并不存在|并未|缺少|缺乏|未(?:发现|找到|见到|获得|公开|发布|提供|进行|曾|披露|确认|验证))/;
const CHINESE_ABSENCE = new RegExp(
  `(?:未|无(?:任何|公开(?:的)?|可用(?:的)?|明确(?:的)?)?)${CHINESE_SUBJECT.source}|${CHINESE_ABSENCE_CUE.source}[^，。；\\n]{0,16}${CHINESE_SUBJECT.source}|${CHINESE_SUBJECT.source}[^，。；\\n]{0,16}${CHINESE_ABSENCE_CUE.source}(?:发生|完成|存在|发布|公开|提供|落地|实现|进行|找到|发现|确认|验证)?`,
  "i",
);
const ENGLISH_SUBJECT = /(?:(?:official\s+)?company\s+name|official\s+name|(?:official\s+)?(?:company\s+)?website|(?:(?:official\s+company|company\s+official|company)\s+urls?)|(?:official\s+)?product\s+page|(?:(?:official\s+product|product\s+official|product)\s+urls?)|funding|financ(?:ing|ed)?|funding\s+(?:round|amount)|valuation|investors?|regulatory\s+filing|deploy(?:ment|ed)?|customers?|deployment\s+(?:location|scale)|release\s+date|code(?:\s+repository)?|datasets?|(?:model\s+)?weights?|institutions?|real[- ]robot\s+(?:experiments?|evidence|trials?))/;
const ENGLISH_ABSENCE_CUE = /(?:no|without|not|never|lack(?:s|ed|ing)?|absence|absent|unavailable|missing|(?:has|have|had|is|are|was|were|does|do|did)n['’]t)/;
const ENGLISH_ABSENCE = new RegExp(
  `\\b${ENGLISH_ABSENCE_CUE.source}\\b.{0,60}\\b${ENGLISH_SUBJECT.source}\\b|\\b${ENGLISH_SUBJECT.source}\\b.{0,60}\\b${ENGLISH_ABSENCE_CUE.source}\\b`,
  "i",
);

/** Reject prose that turns an unresolved public evidence gap into a negative fact. */
export function hasUnsupportedNegativeUnknown(values: readonly string[]): boolean {
  return values.some((value) => CHINESE_ABSENCE.test(value) || ENGLISH_ABSENCE.test(value));
}
