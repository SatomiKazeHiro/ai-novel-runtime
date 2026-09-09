/**
 * 共享 JSON 字段别名机制。
 *
 * AI 抽取 / dedup prompt 用短字段名省 token (例: n/e/t/k/...)，
 * 代码内部用长字段名（nodes/edges/type/key/...）。从 AI 返回的 JSON
 * 解析时优先短名, fallback 长名 —— 兼容老数据 / AI 偶尔写长名。
 */

export type FieldAliasMap = Record<string, string>

/**
 * 读取 obj 字段优先短名, fallback 长名。
 * obj 非对象返回 undefined。
 */
export function aliasKey<T = any>(
  obj: any,
  mapping: FieldAliasMap,
  long: string
): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = mapping[long]
  return (obj[short] ?? obj[long]) as T | undefined
}

/**
 * 关系字面归一映射 prompt 用 (mappings/from/to/variants/canonical)
 * 程序读时优先短名, fallback 长名。
 */
export const RELATION_MAPPING_ALIASES: FieldAliasMap = {
  mappings: 'mappings',
  from: 'f',
  to: 't',
  variants: 'v',
  canonical: 'c'
}

/**
 * graph extract prompt 用 (n/e/t/k/l/d/ft/fk/tt/tk/r)
 */
export const GRAPH_NODE_EDGES_ALIASES: FieldAliasMap = {
  nodes: 'n',
  edges: 'e',
  type: 't',
  key: 'k',
  label: 'l',
  data: 'd',
  fromType: 'ft',
  fromKey: 'fk',
  toType: 'tt',
  toKey: 'tk',
  relation: 'r'
}
