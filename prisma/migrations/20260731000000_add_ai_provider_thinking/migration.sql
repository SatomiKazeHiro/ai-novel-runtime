-- 为 AiProviderConfig 表增加 thinking 三态配置列。
-- 取值: 'auto' | 'enabled' | 'disabled'。
-- 默认 'auto': 请求端根据模型名启发式决定是否关闭思考
-- (当前规则: DeepSeek 模型关闭, 其他模型保留上游默认)。
ALTER TABLE "AiProviderConfig" ADD COLUMN "thinking" TEXT NOT NULL DEFAULT 'auto';
