-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CharacterBranchState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "fromChapterNumber" REAL,
    "status" TEXT NOT NULL DEFAULT '{}',
    "relationships" TEXT NOT NULL DEFAULT '{}',
    "costume" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterBranchState_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CharacterBranchState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- 回填 storyId: 从关联的 Character.storyId 推导
INSERT INTO "new_CharacterBranchState" ("storyId", "characterId", "costume", "createdAt", "fromChapterNumber", "id", "relationships", "status", "updatedAt")
SELECT "Character"."storyId", "CharacterBranchState"."characterId", "CharacterBranchState"."costume", "CharacterBranchState"."createdAt", "CharacterBranchState"."fromChapterNumber", "CharacterBranchState"."id", "CharacterBranchState"."relationships", "CharacterBranchState"."status", "CharacterBranchState"."updatedAt"
FROM "CharacterBranchState"
JOIN "Character" ON "Character"."id" = "CharacterBranchState"."characterId";
DROP TABLE "CharacterBranchState";
ALTER TABLE "new_CharacterBranchState" RENAME TO "CharacterBranchState";
CREATE INDEX "CharacterBranchState_characterId_fromChapterNumber_idx" ON "CharacterBranchState"("characterId", "fromChapterNumber");
CREATE INDEX "CharacterBranchState_storyId_fromChapterNumber_idx" ON "CharacterBranchState"("storyId", "fromChapterNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
