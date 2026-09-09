-- AlterTable
ALTER TABLE "Chapter" RENAME COLUMN "graphDelta" TO "chapterGraph";
ALTER TABLE "Chapter" RENAME COLUMN "graphSnapshot" TO "cumulativeGraph";
