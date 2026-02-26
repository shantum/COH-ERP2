/**
 * WATI Backup Script
 * Exports all data from WATI before migration to Interakt
 */

const BASE = "https://live-mt-server.wati.io/112255";
const TOKEN =
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6InNoYW50dW1AY3JlYXR1cmVzb2ZoYWJpdC5pbiIsIm5hbWVpZCI6InNoYW50dW1AY3JlYXR1cmVzb2ZoYWJpdC5pbiIsImVtYWlsIjoic2hhbnR1bUBjcmVhdHVyZXNvZmhhYml0LmluIiwiYXV0aF90aW1lIjoiMDIvMjYvMjAyNiAxMDo0MDozMSIsInRlbmFudF9pZCI6IjExMjI1NSIsImRiX25hbWUiOiJtdC1wcm9kLVRlbmFudHMiLCJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL3dzLzIwMDgvMDYvaWRlbnRpdHkvY2xhaW1zL3JvbGUiOiJBRE1JTklTVFJBVE9SIiwiZXhwIjoyNTM0MDIzMDA4MDAsImlzcyI6IkNsYXJlX0FJIiwiYXVkIjoiQ2xhcmVfQUkifQ.eWKyVUUgkPtgrgkkqjnZzWfbtV3GF4313_1HMiweWDU";

const BACKUP_DIR = "./backups/wati";
const PAGE_SIZE = 500;
const RATE_LIMIT_MS = 200; // delay between requests
const CHAT_CONCURRENCY = 5; // parallel chat history fetches

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(path: string): Promise<any> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: TOKEN },
  });
  if (!res.ok) {
    console.error(`  FAIL ${res.status} ${res.statusText} — ${path}`);
    return null;
  }
  return res.json();
}

function save(filename: string, data: any) {
  const path = join(BACKUP_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  Saved ${path}`);
}

// ── Step 1: Discover all endpoints via Swagger ──
async function discoverEndpoints() {
  console.log("\n🔍 Discovering API endpoints...");
  for (const path of [
    "/swagger/v1/swagger.json",
    "/swagger/v2/swagger.json",
    "/swagger.json",
  ]) {
    const data = await api(path);
    if (data?.paths) {
      const endpoints = Object.keys(data.paths);
      console.log(`  Found ${endpoints.length} endpoints at ${path}`);
      save("swagger-spec.json", data);
      save(
        "endpoints-list.json",
        endpoints.map((e) => ({
          path: e,
          methods: Object.keys(data.paths[e]),
        }))
      );
      return endpoints;
    }
  }
  console.log("  No swagger spec found, using known endpoints");
  return null;
}

// ── Step 2: Export all contacts (paginated) ──
async function exportContacts() {
  console.log("\n📇 Exporting contacts...");
  const allContacts: any[] = [];
  let page = 1;

  while (true) {
    const data = await api(
      `/api/v1/getContacts?pageSize=${PAGE_SIZE}&pageNumber=${page}`
    );
    if (!data?.contact_list?.length) break;

    allContacts.push(...data.contact_list);
    console.log(
      `  Page ${page}: ${data.contact_list.length} contacts (total: ${allContacts.length})`
    );

    if (data.contact_list.length < PAGE_SIZE) break;
    page++;
    await sleep(RATE_LIMIT_MS);
  }

  save("contacts.json", allContacts);

  // Also create a CSV for easy import
  if (allContacts.length > 0) {
    const customParamKeys = new Set<string>();
    allContacts.forEach((c) =>
      c.customParams?.forEach((p: any) => customParamKeys.add(p.name))
    );
    const paramCols = [...customParamKeys].sort();

    const header = [
      "phone",
      "firstName",
      "fullName",
      "contactStatus",
      "created",
      "source",
      ...paramCols,
    ].join(",");

    const rows = allContacts.map((c) => {
      const paramMap: Record<string, string> = {};
      c.customParams?.forEach((p: any) => (paramMap[p.name] = p.value || ""));
      return [
        c.phone,
        `"${(c.firstName || "").replace(/"/g, '""')}"`,
        `"${(c.fullName || "").replace(/"/g, '""')}"`,
        c.contactStatus,
        c.created,
        c.source || "",
        ...paramCols.map((k) => `"${(paramMap[k] || "").replace(/"/g, '""')}"`),
      ].join(",");
    });

    writeFileSync(join(BACKUP_DIR, "contacts.csv"), [header, ...rows].join("\n"));
    console.log(`  Saved contacts.csv`);
  }

  return allContacts;
}

// ── Step 3: Export message templates ──
async function exportTemplates() {
  console.log("\n📝 Exporting message templates...");
  const data = await api("/api/v1/getMessageTemplates");
  if (data?.messageTemplates) {
    save("message-templates.json", data.messageTemplates);
    console.log(`  Found ${data.messageTemplates.length} templates`);
    return data.messageTemplates;
  }
  return [];
}

// ── Step 4: Export chat history for all contacts (concurrent) ──
async function exportChatHistory(contacts: any[]) {
  console.log("\n💬 Exporting chat history...");
  const chatDir = join(BACKUP_DIR, "chats");
  mkdirSync(chatDir, { recursive: true });

  let exported = 0;
  let failed = 0;
  let empty = 0;
  let processed = 0;

  async function fetchChat(contact: any) {
    const phone = contact.wAid || contact.phone;
    if (!phone) return;

    try {
      const data = await api(`/api/v1/getMessages/${phone}?pageSize=500`);
      const messages: any[] = [];

      if (data?.messages?.items?.length) {
        messages.push(...data.messages.items);
      } else if (data?.result === "success" && Array.isArray(data?.messages)) {
        messages.push(...data.messages);
      }

      if (messages.length > 0) {
        writeFileSync(
          join(chatDir, `${phone}.json`),
          JSON.stringify(messages, null, 2)
        );
        exported++;
      } else {
        empty++;
      }
    } catch {
      failed++;
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(
        `  Progress: ${processed}/${contacts.length} (${exported} chats, ${empty} empty, ${failed} failed)`
      );
    }
  }

  // Process in batches of CHAT_CONCURRENCY
  for (let i = 0; i < contacts.length; i += CHAT_CONCURRENCY) {
    const batch = contacts.slice(i, i + CHAT_CONCURRENCY);
    await Promise.all(batch.map(fetchChat));
    await sleep(RATE_LIMIT_MS);
  }

  console.log(
    `  Done: ${exported} chats exported, ${empty} empty, ${failed} failed`
  );
}

// ── Step 5: Export other data ──
async function exportMisc() {
  console.log("\n📦 Exporting misc data...");

  // Operators/team members
  const operators = await api("/api/v1/getOperators");
  if (operators) save("operators.json", operators);

  await sleep(RATE_LIMIT_MS);

  // Contact tags (v2 endpoint)
  const tags = await api("/api/v2/getContactTags");
  if (tags) save("contact-tags.json", tags);

  await sleep(RATE_LIMIT_MS);

  // Try broadcast/campaign endpoints
  for (const endpoint of [
    "/api/v1/getBroadcasts",
    "/api/v2/getBroadcasts",
    "/api/v1/getCampaigns",
  ]) {
    const data = await api(endpoint);
    if (data && data.result !== "error") {
      const name = endpoint.split("/").pop();
      save(`${name}.json`, data);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Try chatbot/flow endpoints
  for (const endpoint of [
    "/api/v1/getChatbots",
    "/api/v1/getFlows",
    "/api/v2/getFlows",
  ]) {
    const data = await api(endpoint);
    if (data && data.result !== "error") {
      const name = endpoint.split("/").pop();
      save(`${name}.json`, data);
    }
    await sleep(RATE_LIMIT_MS);
  }
}

// ── Main ──
async function main() {
  console.log("=== WATI Full Backup ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  mkdirSync(BACKUP_DIR, { recursive: true });

  // Test connection
  console.log("\n🔌 Testing connection...");
  const test = await api("/api/v1/getContacts?pageSize=1&pageNumber=1");
  if (!test) {
    console.error("❌ Cannot connect to WATI API. Check token.");
    process.exit(1);
  }
  console.log("  Connected!");

  // Run backup steps
  await discoverEndpoints();
  const templates = await exportTemplates();
  const contacts = await exportContacts();
  await exportMisc();

  // Chat history is the big one — ask before proceeding
  console.log(`\n📊 Summary so far:`);
  console.log(`  Contacts: ${contacts.length}`);
  console.log(`  Templates: ${templates.length}`);
  console.log(
    `\n  Chat history export will make ~${contacts.length} API calls.`
  );
  console.log(`  Estimated time: ~${Math.ceil((contacts.length * RATE_LIMIT_MS) / 60000)} minutes`);
  console.log(`  Starting chat export...`);

  await exportChatHistory(contacts);

  console.log("\n✅ Backup complete!");
  console.log(`  All data saved to: ${BACKUP_DIR}/`);
}

main().catch(console.error);
