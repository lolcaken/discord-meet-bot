/**
 * Prints the effective configuration, so you can see what the bot is actually
 * running with - which switches are on, and which file they came from.
 */
import { loadConfig, configPath, hasConfigFile } from "../src/config.js";
import { existsSync } from "node:fs";

const { commands, features, limits } = loadConfig();

console.log(`config file : ${configPath}`);
console.log(`             ${hasConfigFile() ? "found" : "not found - using the defaults"}`);
console.log(`             ${existsSync(configPath) ? "(edit this to change the switches)" : "(create it to change the switches)"}`);

console.log("\ncommands");
for (const [name, on] of Object.entries(commands)) {
  console.log(`  ${on ? "on " : "off"}  ${name}`);
}

console.log("\nfeatures");
for (const [name, on] of Object.entries(features)) {
  console.log(`  ${on ? "on " : "off"}  ${name}`);
}

console.log("\nlimits");
for (const [name, value] of Object.entries(limits)) {
  console.log(`  ${name}: ${value}`);
}

console.log("\nSecrets are not in this file - they live in .env, which is never committed.");
