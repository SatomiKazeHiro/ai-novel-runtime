-- CreateTable
CREATE TABLE "PlotArcProgressPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "arcId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "isEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlotArcProgressPoint_arcId_fkey" FOREIGN KEY ("arcId") REFERENCES "PlotArc" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlotArc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMainline" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "firstChapterNumber" INTEGER NOT NULL,
    "closedBy" TEXT,
    "closedTargetArcId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlotArc_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlotArc" ("closedTargetArcId", "createdAt", "id", "name", "status", "storyId", "updatedAt") SELECT "closedTargetArcId", "createdAt", "id", "name", "status", "storyId", "updatedAt" FROM "PlotArc";
DROP TABLE "PlotArc";
ALTER TABLE "new_PlotArc" RENAME TO "PlotArc";
CREATE INDEX "PlotArc_storyId_status_idx" ON "PlotArc"("storyId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlotArcProgressPoint_arcId_chapterNumber_idx" ON "PlotArcProgressPoint"("arcId", "chapterNumber");

-- CreateIndex
CREATE INDEX "PlotArcProgressPoint_chapterNumber_idx" ON "PlotArcProgressPoint"("chapterNumber");
