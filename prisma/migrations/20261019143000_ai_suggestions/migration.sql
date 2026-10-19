ALTER TABLE "Project" ADD COLUMN "analysisStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "Project" ADD COLUMN "analysisProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "analysisError" TEXT;
ALTER TABLE "Project" ADD COLUMN "analysisTranscript" JSONB;
ALTER TABLE "Project" ADD COLUMN "suggestions" JSONB;
