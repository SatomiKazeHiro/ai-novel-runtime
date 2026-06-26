-- TimelineEvent.day (Int) → position (Float): 实数时间编码 YYYY.MMDD.HH
-- SQLite 没有 ALTER COLUMN TYPE, 必须重建表。
-- 旧 day 数据按整数搬到 position (语义暂保留, 待手动修正成 YYYY.MMDD.HH 编码)。

CREATE TABLE "TimelineEvent_new" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storyId" TEXT NOT NULL,
  "fromChapterNumber" REAL,
  "position" REAL NOT NULL,
  "events" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE
);

-- 原表 TimelineEvent 只有 "day" (Int) 列, 没有 "position".
-- SQLite 动态类型: 把 INT 列 "day" 拷到新表 REAL 列 "position" 会自动 cast。
-- 早期版本的 SQL 误写成 CAST("position" AS REAL), fresh install 时会爆
-- "no such column: position"; 现已修。
INSERT INTO "TimelineEvent_new" ("id", "storyId", "fromChapterNumber", "position", "events", "createdAt", "updatedAt")
SELECT "id", "storyId", "fromChapterNumber", "day", "events", "createdAt", "updatedAt" FROM "TimelineEvent";

DROP TABLE "TimelineEvent";
ALTER TABLE "TimelineEvent_new" RENAME TO "TimelineEvent";

-- Chapter.timelinePosition: 本章开篇时间锚点
ALTER TABLE "Chapter" ADD COLUMN "timelinePosition" REAL;

-- @@unique([storyId, position])
CREATE UNIQUE INDEX "TimelineEvent_storyId_position_key" ON "TimelineEvent"("storyId", "position");