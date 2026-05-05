#!/usr/bin/env npx tsx
import { createProgram } from "../src/cli/index.js";

const program = createProgram();
program.parse(process.argv);
