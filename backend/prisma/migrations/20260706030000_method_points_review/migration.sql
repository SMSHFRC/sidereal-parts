-- AlterTable
ALTER TABLE "manufacturing_methods" ADD COLUMN     "base_points" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "requires_review" BOOLEAN NOT NULL DEFAULT false;

