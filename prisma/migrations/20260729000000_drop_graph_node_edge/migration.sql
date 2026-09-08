-- DropGraphNodeEdge
-- v3 唯一图谱数据源 = Chapter.cumulativeGraph JSON, GraphNode/GraphEdge 表不再使用。
-- 删除顺序: GraphEdge 先 (有 FK), GraphNode 后。
DROP TABLE IF EXISTS "GraphEdge";
DROP TABLE IF EXISTS "GraphNode";