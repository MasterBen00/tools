<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { ArrowLeftRight, ClipboardPaste, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CodeBlock, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { translate } from "./mongoSql";

type Dir = "sql2mongo" | "mongo2sql";

const EXAMPLES: { label: string; dir: Dir; text: string }[] = [
    { label: "SQL: filter, sort, limit", dir: "sql2mongo", text: "SELECT name, email\nFROM users\nWHERE age >= 18 AND status = 'active'\nORDER BY created_at DESC\nLIMIT 10;" },
    { label: "SQL: IN, LIKE, IS NULL", dir: "sql2mongo", text: "SELECT *\nFROM products\nWHERE category IN ('books', 'music')\n  AND title LIKE 'The%'\n  AND discontinued_at IS NULL;" },
    { label: "SQL: OR, NOT, BETWEEN, paging", dir: "sql2mongo", text: "SELECT id, total AS amount\nFROM orders\nWHERE (status = 'paid' OR status = 'shipped')\n  AND NOT (total BETWEEN 0 AND 10)\nORDER BY amount DESC, id\nLIMIT 20 OFFSET 40;" },
    { label: "SQL: GROUP BY with HAVING", dir: "sql2mongo", text: "SELECT customer_id, COUNT(*) AS orders, SUM(total) AS revenue, AVG(total)\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY customer_id\nHAVING COUNT(*) > 5\nORDER BY revenue DESC\nLIMIT 10;" },
    { label: "SQL: COUNT(*)", dir: "sql2mongo", text: "SELECT COUNT(*) FROM users WHERE country = 'BD';" },
    { label: "SQL: JOIN (not supported)", dir: "sql2mongo", text: "SELECT u.name, o.total\nFROM users u\nJOIN orders o ON o.user_id = u.id\nWHERE o.total > 100;" },
    { label: "Mongo: find with regex and projection", dir: "mongo2sql", text: "db.users.find(\n  { age: { $gte: 18 }, status: 'active', email: /@example\\.com$/i },\n  { name: 1, email: 1, _id: 0 }\n).sort({ createdAt: -1 }).skip(20).limit(10)" },
    { label: "Mongo: $or, ObjectId, $exists", dir: "mongo2sql", text: "db.users.find({\n  $or: [{ role: 'admin' }, { _id: ObjectId('65a1f0c2e4b0a1b2c3d4e5f6') }],\n  deletedAt: { $exists: false },\n  score: { $not: { $lt: 50 } }\n})" },
    { label: "Mongo: aggregate $group", dir: "mongo2sql", text: "db.orders.aggregate([\n  { $match: { status: { $in: ['paid', 'shipped'] }, createdAt: { $gte: ISODate('2025-01-01T00:00:00Z') } } },\n  { $group: { _id: '$customerId', orders: { $sum: 1 }, revenue: { $sum: '$total' } } },\n  { $match: { orders: { $gt: 5 } } },\n  { $sort: { revenue: -1 } },\n  { $limit: 10 }\n])" },
    { label: "Mongo: $lookup (not supported)", dir: "mongo2sql", text: "db.orders.aggregate([\n  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },\n  { $unwind: '$user' },\n  { $match: { total: { $gt: 100 } } }\n])" },
];

const dir = useStorage<Dir>("devtools:mongo-sql-translator:dir", "sql2mongo");
const sqlInput = useStorage("devtools:mongo-sql-translator:sql", EXAMPLES[3].text);
const mongoInput = useStorage("devtools:mongo-sql-translator:mongo", EXAMPLES[8].text);
const example = ref("");
const outTab = ref<"mongo" | "java">("mongo");

const input = computed({
    get: () => (dir.value === "sql2mongo" ? sqlInput.value : mongoInput.value),
    set: (v: string) => (dir.value === "sql2mongo" ? (sqlInput.value = v) : (mongoInput.value = v)),
});

watch(example, (i) => {
    const ex = EXAMPLES[Number(i)];
    if (ex) {
        dir.value = ex.dir;
        input.value = ex.text;
    }
    example.value = "";
});

const result = computed(() => translate(dir.value, input.value));
const shownOutput = computed(() => (dir.value === "sql2mongo" && outTab.value === "java" ? (result.value.java ?? "") : result.value.output));
const outLang = computed(() => (dir.value === "mongo2sql" ? "sql" : outTab.value === "java" ? "java" : "javascript"));

function swap() {
    if (!result.value.output) {
        dir.value = dir.value === "sql2mongo" ? "mongo2sql" : "sql2mongo";
        return;
    }
    const out = result.value.output;
    dir.value = dir.value === "sql2mongo" ? "mongo2sql" : "sql2mongo";
    input.value = out;
}

useHandoff<{ input?: string; dir?: Dir }>("mongo-sql-translator", (p) => {
    if (p.dir) dir.value = p.dir;
    else if (p.input != null) dir.value = /^\s*db\s*\./.test(p.input) ? "mongo2sql" : "sql2mongo";
    if (p.input != null) input.value = p.input;
});
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs v-model="dir" :options="[{ value: 'sql2mongo', label: 'SQL → MongoDB' }, { value: 'mongo2sql', label: 'MongoDB → SQL' }]" />
        </template>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <select v-model="example" class="select !w-auto" aria-label="Examples">
                <option value="">Examples…</option>
                <option v-for="(ex, i) in EXAMPLES" :key="i" :value="String(i)">{{ ex.label }}</option>
            </select>
            <span class="text-xs text-muted">
                {{
                    dir === "sql2mongo"
                        ? "One SELECT on one table: WHERE, GROUP BY / HAVING, ORDER BY, LIMIT / OFFSET, COUNT/SUM/AVG/MIN/MAX."
                        : "db.coll.find(…).sort().skip().limit(), countDocuments, distinct, or aggregate([…]) with $match, $group, $sort, $skip, $limit, $project, $count."
                }}
            </span>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel :title="dir === 'sql2mongo' ? 'SQL' : 'MongoDB shell query'" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="async () => (input = await readClipboard())"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea
                    v-model="input"
                    :language="dir === 'sql2mongo' ? 'sql' : 'javascript'"
                    :wrap="false"
                    height="22rem"
                    :invalid="!!result.error"
                    :placeholder="dir === 'sql2mongo' ? 'SELECT … FROM … WHERE …' : 'db.users.find({ age: { $gt: 18 } })'"
                />
            </Panel>
            <Panel flush>
                <template #title>{{ dir === "sql2mongo" ? "MongoDB" : "SQL" }}</template>
                <template #actions>
                    <Tabs
                        v-if="dir === 'sql2mongo'"
                        v-model="outTab"
                        size="sm"
                        :options="[{ value: 'mongo', label: 'mongosh' }, { value: 'java', label: 'Spring Data' }]"
                    />
                    <Btn size="sm" variant="ghost" title="Use the output as input in the other direction" @click="swap"><ArrowLeftRight /> Swap</Btn>
                    <CopyButton :text="shownOutput" />
                </template>
                <div class="min-h-[22rem] overflow-auto">
                    <CodeBlock v-if="shownOutput" :code="shownOutput" :language="outLang" />
                    <p v-else class="p-4 text-sm text-muted">{{ result.error ? "No translation." : "The translation appears here." }}</p>
                </div>
            </Panel>
        </div>

        <Notice v-if="result.error" type="error">{{ result.error }}</Notice>
        <Notice v-if="result.unsupported.length && !result.error" type="warning">
            <p class="font-medium">Not supported, skipped. The output does not include these parts and can return different results:</p>
            <ul class="mt-1 list-disc pl-4">
                <li v-for="(u, i) in result.unsupported" :key="i">{{ u }}</li>
            </ul>
        </Notice>
        <Notice v-for="(n, i) in result.notes" :key="'n' + i" type="info">{{ n }}</Notice>
        <Notice v-if="dir === 'sql2mongo' && outTab === 'java' && result.java" type="info">
            Spring Data MongoDB snippet using MongoTemplate, Query, Criteria and Aggregation; treat it as a starting point and map the Document class to your entity.
        </Notice>
    </ToolPage>
</template>
