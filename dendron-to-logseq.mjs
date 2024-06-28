#!/usr/bin/env node
"use strict";

import { ArgumentParser } from "argparse";
import * as glob from "glob";
import * as fs from "fs/promises";
import * as path from "path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import * as yaml from "yaml";

class Vault {
  constructor(dendronVault, logseqGraph, dendronJournalHierarchy) {
    this.dendronVault = dendronVault;
    this.logseqGraph = logseqGraph;
    this.dendronJournalHierarchy = dendronJournalHierarchy;
  }

  dendronNodeHierarchyPosition(dendronNodePath) {
    return path.basename(dendronNodePath, ".md");
  }

  isDendronJournalNode(dendronNodePath) {
    if (typeof this.dendronJournalHierarchy !== "string") return;
    let absHierarchyPos = this.dendronNodeHierarchyPosition(dendronNodePath);
    return absHierarchyPos.startsWith(`${this.dendronJournalHierarchy}.`);
  }

  get logseqJournalDir() {
    return path.join(this.logseqGraph, "journals");
  }

  get logseqPageDir() {
    return path.join(this.logseqGraph, "pages");
  }

  logseqDestPath(dendronNodePath) {
    if (this.isDendronJournalNode(dendronNodePath))
      return this.logseqJournalPath(dendronNodePath);
    else
      return this.logseqPagePath(dendronNodePath);
  }

  logseqJournalPath(dendronNodePath) {
    if (typeof this.dendronJournalHierarchy !== "string")
      throw new Error("can't template journal path without Dendron hierarchy location");
    let absHierarchyPos = this.dendronNodeHierarchyPosition(dendronNodePath);
    let relHierarchyPos = absHierarchyPos.slice(this.dendronJournalHierarchy.length + 1).replace(/\./g, "_");
    return path.join(this.logseqJournalDir, `${relHierarchyPos}.md`);
  }

  logseqPagePath(dendronNodePath) {
    let absHierarchyPos = this.dendronNodeHierarchyPosition(dendronNodePath);
    return path.join(this.logseqPageDir, `${absHierarchyPos.replace(/\./g, "___")}.md`)
  }
}

function parse_args() {
  let parser = new ArgumentParser({
    description: "Convert Dendron vaults to Logseq graphs",
  });
  parser.add_argument("-V", "--vault", {
    dest: "vaults",
    nargs: 3,
    action: "append",
    metavar: "PATH",
    help: "repeat for multiple vaults",
  });
  let subparsers = parser.add_subparsers({ dest: "action" });

  let check = subparsers.add_parser("check", { help: "Pre-check" });

  let convert = subparsers.add_parser("convert", { help: "Do conversion" });
  convert.add_argument("-r", "--remove-titles", {
    action: "store_true",
    help: "Strip title attributes from Frontmatter?",
  });

  return parser.parse_args();
}

class MarkdownProcessor {
  constructor() {
    this.processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkStringify)
      .use(() => {
        return (tree) => {
          this.lastFrontmatter = yaml.parse(tree.children[0].value);
        };
      });
  }

  async process(path) {
    let content = await fs.readFile(path, "utf-8");
    this.processor.process(content);
    return this.lastFrontmatter;
  }
}

async function check(vault, processor, files) {
  let processed = 0;
  let processes = [];
  let titles = {};

  files.on("data", async (path) => {
    processed++;
    let processPromise = processor.process(path);
    processes.push(processPromise);
    let frontmatter = await processPromise;
    if (!titles.hasOwnProperty(frontmatter.title))
      titles[frontmatter.title] = [];
    titles[frontmatter.title].push(path);
  });
  files.on("end", async () => {
    await Promise.all(processes);
    console.info(`processed ${processed} files`);
    for (let [title, paths] of Object.entries(titles)) {
      if (paths.length > 1) {
        console.warn(`[TITLE] ${title}:\n  - ${paths.join("\n  - ")}`);
      }
    }
  });
}

/**
 * @param {Vault} vault 
 * @param {MarkdownProcessor} processor 
 */
async function convert(vault, processor, files) {
  let processed = 0;

  files.on("data", async (srcPath) => {
    let destPath = vault.logseqDestPath(srcPath);
    console.log(srcPath, "->", destPath);
    await fs.copyFile(srcPath, destPath);
    processed++;
  });
  files.on("end", () => {
    console.info(`processed ${processed} files`);
  });
}

async function main() {
  const args = parse_args();

  // argparse's type and nargs don't play well, might be a bug
  const vaults = args.vaults.map((v) => new Vault(v[0], v[1], v[2]));

  for (const vault of vaults) {
    console.info(
      `processing vault ${vault.dendronVault} to graph ${vault.logseqGraph}`,
    );

    let processor = new MarkdownProcessor();
    let files = glob.stream(`${vault.dendronVault}/*.md`);

    switch (args.action) {
      case "check":
        await check(vault, processor, files);
        break;
      case "convert":
        await convert(vault, processor, files);
        break;
      default:
        console.error("unknown action", action);
    }
  }
}

await main();
