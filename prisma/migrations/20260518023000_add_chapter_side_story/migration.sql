-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "number" REAL NOT NULL,
    "isSideStory" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "outline" TEXT,
    "content" TEXT,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sceneLocation" TEXT,
    "sceneMood" TEXT,
    "sceneGoal" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Chapter" ("content", "createdAt", "id", "number", "outline", "sceneGoal", "sceneLocation", "sceneMood", "status", "storyId", "summary", "title", "updatedAt") SELECT "content", "createdAt", "id", "number", "outline", "sceneGoal", "sceneLocation", "sceneMood", "status", "storyId", "summary", "title", "updatedAt" FROM "Chapter";
DROP TABLE "Chapter";
ALTER TABLE "new_Chapter" RENAME TO "Chapter";
CREATE UNIQUE INDEX "Chapter_storyId_number_key" ON "Chapter"("storyId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
