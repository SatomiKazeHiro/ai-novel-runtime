/*
  Warnings:

  - You are about to drop the column `characterConsistency` on the `Score` table. All the data in the column will be lost.
  - You are about to drop the column `forbiddenContentRisk` on the `Score` table. All the data in the column will be lost.
  - You are about to drop the column `loreConsistency` on the `Score` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Score" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "draftId" TEXT,
    "styleSimilarity" REAL,
    "outlineAdherence" REAL,
    "sceneMatch" REAL,
    "profileConsistency" REAL,
    "proseQuality" REAL,
    "emotionalTension" REAL,
    "pacing" REAL,
    "totalScore" REAL,
    "comment" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Score_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Score" ("chapterId", "createdAt", "details", "draftId", "emotionalTension", "id", "pacing", "proseQuality", "storyId", "styleSimilarity", "totalScore") SELECT "chapterId", "createdAt", "details", "draftId", "emotionalTension", "id", "pacing", "proseQuality", "storyId", "styleSimilarity", "totalScore" FROM "Score";
DROP TABLE "Score";
ALTER TABLE "new_Score" RENAME TO "Score";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
