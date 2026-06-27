-- 1. 新增字段 (nullable 或带 default)
ALTER TABLE PlotArc ADD COLUMN closedReason TEXT;
ALTER TABLE PlotArc ADD COLUMN closedTargetArcId TEXT;
ALTER TABLE PlotArc ADD COLUMN lastTouchedChapter INTEGER;
ALTER TABLE PlotArc ADD COLUMN similarToExistingIds TEXT NOT NULL DEFAULT '[]';

-- 2. 数据回填: pending → active
UPDATE PlotArc SET status = 'active' WHERE status = 'pending';

-- 3. 数据回填: lastTouchedChapter = 该故事最近 archived 章节号
UPDATE PlotArc SET lastTouchedChapter = (
  SELECT MAX(number) FROM Chapter
  WHERE Chapter.storyId = PlotArc.storyId
    AND Chapter.status = 'archived'
) WHERE lastTouchedChapter IS NULL;

-- 4. status 默认值改为 'active' (新 arc 不再走 pending)
--    SQLite 不支持 ALTER COLUMN, 用重建表模拟:
CREATE TABLE "new_PlotArc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'active',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stages" TEXT NOT NULL DEFAULT '[]',
    "currentStage" TEXT,
    "nextGoal" TEXT,
    "unresolved" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "closedReason" TEXT,
    "closedTargetArcId" TEXT,
    "lastTouchedChapter" INTEGER,
    "similarToExistingIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE
);

INSERT INTO "new_PlotArc" (
    "id", "storyId", "name", "type", "status", "progress", "stages",
    "currentStage", "nextGoal", "unresolved", "summary",
    "closedReason", "closedTargetArcId", "lastTouchedChapter", "similarToExistingIds",
    "createdAt", "updatedAt"
)
SELECT
    "id", "storyId", "name", "type", "status", "progress", "stages",
    "currentStage", "nextGoal", "unresolved", "summary",
    "closedReason", "closedTargetArcId", "lastTouchedChapter", "similarToExistingIds",
    "createdAt", "updatedAt"
FROM "PlotArc";

DROP TABLE "PlotArc";
ALTER TABLE "new_PlotArc" RENAME TO "PlotArc";

-- 5. 重建索引
CREATE INDEX "PlotArc_storyId_status_idx" ON "PlotArc"("storyId", "status");
CREATE INDEX "PlotArc_storyId_status_lastTouchedChapter_idx" ON "PlotArc"("storyId", "status", "lastTouchedChapter");

-- 6. 重建外键 (Prisma 会从 schema 重新生成, 这里不需要)