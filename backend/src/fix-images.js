import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { User } from "./models.js";

dotenv.config();

const __dirnamePath = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirnamePath, "..", "uploads");

function saveBase64Image(base64Str, prefix) {
  if (!base64Str || !base64Str.startsWith("data:image/")) return base64Str;
  
  const matches = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return base64Str;
  
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const data = Buffer.from(matches[2], 'base64');
  const filename = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
  const filepath = path.join(uploadsDir, filename);
  
  fs.writeFileSync(filepath, data);
  return `/uploads/${filename}`;
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careline";
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB for image migration.");

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const users = await User.find({ "profile.clinicPicture": { $regex: /^data:image\// } });
  
  console.log(`Found ${users.length} users with Base64 clinic pictures.`);

  for (const u of users) {
    if (u.profile && u.profile.clinicPicture) {
      const newPath = saveBase64Image(u.profile.clinicPicture, `clinic-${u._id}`);
      if (newPath !== u.profile.clinicPicture) {
        u.profile.clinicPicture = newPath;
        u.markModified('profile');
        await u.save();
        console.log(`Migrated clinic picture for user: ${u.fullName} (${u._id})`);
      }
    }
  }

  console.log("Migration complete.");
  await mongoose.disconnect();
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
