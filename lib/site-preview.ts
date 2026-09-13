import fs from "fs/promises";
import path from "path";
import os from "os";

const filesRoot = path.resolve(
  process.env.JARVIS_FILES_DIR || path.join(os.homedir(), "jarvis-files"),
);

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

export async function readSitePreviewFile(project: string, fileParts: string[]) {
  const projectRoot = path.resolve(filesRoot, project);
  const relativeProject = path.relative(filesRoot, projectRoot);
  if (!project || relativeProject.startsWith("..") || path.isAbsolute(relativeProject)) {
    return null;
  }

  const filename = fileParts.length > 0 ? fileParts.join("/") : "index.html";
  const target = path.resolve(projectRoot, filename);
  const relativeTarget = path.relative(projectRoot, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) return null;

  try {
    const data = await fs.readFile(target);
    return { data, contentType: mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream" };
  } catch {
    return null;
  }
}
