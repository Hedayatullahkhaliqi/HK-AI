import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const platform = process.argv[2];

if (platform === "android") {
  const manifest = resolve("android/app/src/main/AndroidManifest.xml");
  if (!existsSync(manifest)) throw new Error("AndroidManifest.xml was not generated.");

  let xml = readFileSync(manifest, "utf8");
  const permission = '<uses-permission android:name="android.permission.RECORD_AUDIO" />';
  if (!xml.includes("android.permission.RECORD_AUDIO")) {
    xml = xml.replace("<application", `  ${permission}\n  <application`);
    writeFileSync(manifest, xml, "utf8");
  }
  console.log("Added Android microphone permission.");
} else if (platform === "ios") {
  const plist = resolve("ios/App/App/Info.plist");
  if (!existsSync(plist)) throw new Error("iOS Info.plist was not generated.");

  let xml = readFileSync(plist, "utf8");
  if (!xml.includes("NSMicrophoneUsageDescription")) {
    const privacyEntry = `\t<key>NSMicrophoneUsageDescription</key>\n\t<string>HK.AI uses the microphone so you can speak your questions.</string>\n`;
    xml = xml.replace("</dict>", `${privacyEntry}</dict>`);
    writeFileSync(plist, xml, "utf8");
  }
  console.log("Added iOS microphone usage description.");
} else {
  throw new Error("Choose android or ios.");
}
