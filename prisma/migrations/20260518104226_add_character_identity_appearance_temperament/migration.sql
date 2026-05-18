-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personality" TEXT NOT NULL DEFAULT '[]',
    "speechStyle" TEXT NOT NULL DEFAULT '[]',
    "identity" TEXT NOT NULL DEFAULT '[]',
    "appearance" TEXT NOT NULL DEFAULT '[]',
    "temperament" TEXT NOT NULL DEFAULT '[]',
    "relationships" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Character" ("createdAt", "id", "name", "personality", "relationships", "slug", "speechStyle", "status", "storyId", "updatedAt") SELECT "createdAt", "id", "name", "personality", "relationships", "slug", "speechStyle", "status", "storyId", "updatedAt" FROM "Character";
DROP TABLE "Character";
ALTER TABLE "new_Character" RENAME TO "Character";
CREATE UNIQUE INDEX "Character_storyId_slug_key" ON "Character"("storyId", "slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
