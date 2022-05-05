import { copyFile } from "node:fs/promises";

try {
  await Promise.all([
    copyFile("README.md", "dist/README.md"),
    copyFile("package.json", "dist/package.json"),
  ]);
} catch (e) {
  console.log("Failed to copy files", e);
}
