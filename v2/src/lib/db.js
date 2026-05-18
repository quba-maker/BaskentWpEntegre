"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sql = void 0;
var serverless_1 = require("@neondatabase/serverless");
var databaseUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";
exports.sql = (0, serverless_1.neon)(databaseUrl);
