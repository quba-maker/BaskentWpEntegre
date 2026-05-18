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
exports.IdentityEngine = void 0;
var db_1 = require("@/lib/db");
var IdentityEngine = /** @class */ (function () {
    function IdentityEngine() {
    }
    /**
     * Resolves a customer identity by phone number.
     * Creates a new profile if it doesn't exist, otherwise returns the existing one.
     * Merges incoming data (e.g. from forms or WhatsApp) to enrich the profile.
     */
    IdentityEngine.resolveIdentity = function (params) {
        return __awaiter(this, void 0, void 0, function () {
            var tenantId, phoneNumber, email, firstName, lastName, normalizedPhone, result, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        tenantId = params.tenantId, phoneNumber = params.phoneNumber, email = params.email, firstName = params.firstName, lastName = params.lastName;
                        if (!phoneNumber) {
                            throw new Error('[IdentityEngine] Phone number is required for identity resolution.');
                        }
                        normalizedPhone = this.normalizePhone(phoneNumber);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, db_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n        INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)\n        VALUES (", ", ", ", ", ", ", ", ", ")\n        ON CONFLICT (tenant_id, primary_phone) DO UPDATE SET\n          primary_email = COALESCE(customer_profiles.primary_email, EXCLUDED.primary_email),\n          first_name = COALESCE(customer_profiles.first_name, EXCLUDED.first_name),\n          last_name = COALESCE(customer_profiles.last_name, EXCLUDED.last_name),\n          updated_at = NOW()\n        RETURNING id;\n      "], ["\n        INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)\n        VALUES (", ", ", ", ", ", ", ", ", ")\n        ON CONFLICT (tenant_id, primary_phone) DO UPDATE SET\n          primary_email = COALESCE(customer_profiles.primary_email, EXCLUDED.primary_email),\n          first_name = COALESCE(customer_profiles.first_name, EXCLUDED.first_name),\n          last_name = COALESCE(customer_profiles.last_name, EXCLUDED.last_name),\n          updated_at = NOW()\n        RETURNING id;\n      "])), tenantId, normalizedPhone, email || null, firstName || null, lastName || null)];
                    case 2:
                        result = _a.sent();
                        return [2 /*return*/, result[0].id];
                    case 3:
                        error_1 = _a.sent();
                        console.error('[IdentityEngine] Failed to resolve identity:', error_1);
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Links an existing conversation to a customer_profile.
     */
    IdentityEngine.linkConversation = function (conversationId, customerId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, (0, db_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["\n      UPDATE conversations \n      SET customer_id = ", ", updated_at = NOW()\n      WHERE id = ", ";\n    "], ["\n      UPDATE conversations \n      SET customer_id = ", ", updated_at = NOW()\n      WHERE id = ", ";\n    "])), customerId, conversationId)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Links an existing lead (form submission) to a customer_profile.
     */
    IdentityEngine.linkLead = function (leadId, customerId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, (0, db_1.sql)(templateObject_3 || (templateObject_3 = __makeTemplateObject(["\n      UPDATE leads \n      SET customer_id = ", ", updated_at = NOW()\n      WHERE id = ", ";\n    "], ["\n      UPDATE leads \n      SET customer_id = ", ", updated_at = NOW()\n      WHERE id = ", ";\n    "])), customerId, leadId)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Helper to normalize phone numbers (e.g., removing +, spaces, brackets)
     * Converts +90 555 123 45 67 to 905551234567
     */
    IdentityEngine.normalizePhone = function (phone) {
        return phone.replace(/\D/g, '');
    };
    /**
     * Fetches unified customer context (Profile + CRM + Form Data + Memory) for AI Orchestration.
     */
    IdentityEngine.getContext = function (customerId, conversationId) {
        return __awaiter(this, void 0, void 0, function () {
            var profiles, profile, leads, lead, memory, memories, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 5, , 6]);
                        return [4 /*yield*/, (0, db_1.sql)(templateObject_4 || (templateObject_4 = __makeTemplateObject(["SELECT * FROM customer_profiles WHERE id = ", ""], ["SELECT * FROM customer_profiles WHERE id = ", ""])), customerId)];
                    case 1:
                        profiles = _a.sent();
                        profile = profiles[0];
                        if (!profile)
                            return [2 /*return*/, null];
                        return [4 /*yield*/, (0, db_1.sql)(templateObject_5 || (templateObject_5 = __makeTemplateObject(["\n        SELECT form_name, raw_data \n        FROM leads \n        WHERE tenant_id = ", " AND (\n          customer_id = ", " OR \n          phone_number LIKE '%' || RIGHT(", ", 10) || '%'\n        )\n        ORDER BY created_at DESC \n        LIMIT 1\n      "], ["\n        SELECT form_name, raw_data \n        FROM leads \n        WHERE tenant_id = ", " AND (\n          customer_id = ", " OR \n          phone_number LIKE '%' || RIGHT(", ", 10) || '%'\n        )\n        ORDER BY created_at DESC \n        LIMIT 1\n      "])), profile.tenant_id, customerId, profile.primary_phone)];
                    case 2:
                        leads = _a.sent();
                        lead = leads[0];
                        memory = null;
                        if (!conversationId) return [3 /*break*/, 4];
                        return [4 /*yield*/, (0, db_1.sql)(templateObject_6 || (templateObject_6 = __makeTemplateObject(["SELECT * FROM conversation_memory WHERE conversation_id = ", ""], ["SELECT * FROM conversation_memory WHERE conversation_id = ", ""])), conversationId)];
                    case 3:
                        memories = _a.sent();
                        memory = memories[0];
                        _a.label = 4;
                    case 4: return [2 /*return*/, {
                            profile: profile,
                            latestForm: lead ? { name: lead.form_name, data: lead.raw_data } : null,
                            memory: memory ? {
                                summary: memory.summary_text,
                                intent: memory.buying_intent,
                                sentiment: memory.sentiment,
                                objections: memory.objections
                            } : null
                        }];
                    case 5:
                        e_1 = _a.sent();
                        console.error('[IdentityEngine] Failed to get context', e_1);
                        return [2 /*return*/, null];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    return IdentityEngine;
}());
exports.IdentityEngine = IdentityEngine;
var templateObject_1, templateObject_2, templateObject_3, templateObject_4, templateObject_5, templateObject_6;
