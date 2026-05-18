"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var identity_1 = require("./src/lib/services/ai/engines/identity");
var db_1 = require("./src/lib/db");
function test() {
    return __awaiter(this, void 0, void 0, function () {
        var leads, _i, leads_1, lead, normalizedPhone, profiles, context, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 6, , 7]);
                    return [4 /*yield*/, (0, db_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["SELECT id, form_name, raw_data, phone_number, customer_id, tenant_id FROM leads ORDER BY created_at DESC LIMIT 5"], ["SELECT id, form_name, raw_data, phone_number, customer_id, tenant_id FROM leads ORDER BY created_at DESC LIMIT 5"])))];
                case 1:
                    leads = _a.sent();
                    console.log("=== RECENT LEADS ===");
                    for (_i = 0, leads_1 = leads; _i < leads_1.length; _i++) {
                        lead = leads_1[_i];
                        console.log("Lead ID: ".concat(lead.id, ", Phone: ").concat(lead.phone_number, ", Customer: ").concat(lead.customer_id, ", Tenant: ").concat(lead.tenant_id));
                    }
                    if (!(leads.length > 0)) return [3 /*break*/, 5];
                    normalizedPhone = identity_1.IdentityEngine.normalizePhone(leads[0].phone_number);
                    console.log("\nTesting with phone:", normalizedPhone);
                    return [4 /*yield*/, (0, db_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["SELECT * FROM customer_profiles WHERE primary_phone = ", " ORDER BY created_at DESC LIMIT 1"], ["SELECT * FROM customer_profiles WHERE primary_phone = ", " ORDER BY created_at DESC LIMIT 1"])), normalizedPhone)];
                case 2:
                    profiles = _a.sent();
                    if (!(profiles.length > 0)) return [3 /*break*/, 4];
                    console.log("Found profile:", profiles[0].id);
                    return [4 /*yield*/, identity_1.IdentityEngine.getContext(profiles[0].id, "")];
                case 3:
                    context = _a.sent();
                    console.log("\n=== IDENTITY ENGINE CONTEXT ===");
                    console.log(JSON.stringify(context, null, 2));
                    return [3 /*break*/, 5];
                case 4:
                    console.log("No profile found for this phone number.");
                    _a.label = 5;
                case 5: return [3 /*break*/, 7];
                case 6:
                    e_1 = _a.sent();
                    console.error(e_1);
                    return [3 /*break*/, 7];
                case 7:
                    process.exit(0);
                    return [2 /*return*/];
            }
        });
    });
}
test();
var templateObject_1, templateObject_2;
