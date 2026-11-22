<script setup lang="ts">
import { computed } from "vue";
import { useStorage } from "@vueuse/core";
import { ArrowLeftRight, ClipboardPaste, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { convertBuild, type BuildFmt } from "./mavenGradle";

const fmts: { value: BuildFmt; label: string }[] = [
    { value: "maven", label: "Maven pom.xml" },
    { value: "groovy", label: "Gradle Groovy" },
    { value: "kotlin", label: "Gradle Kotlin" },
];

const SAMPLES: Record<BuildFmt, string> = {
    maven: `<properties>
    <java.version>21</java.version>
    <spring-cloud.version>2024.0.0</spring-cloud.version>
    <mapstruct.version>1.6.3</mapstruct.version>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-dependencies</artifactId>
            <version>\${spring-cloud.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <exclusions>
            <exclusion>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-tomcat</artifactId>
            </exclusion>
        </exclusions>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-undertow</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-openfeign</artifactId>
    </dependency>
    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct</artifactId>
        <version>\${mapstruct.version}</version>
    </dependency>
    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>\${mapstruct.version}</version>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
        <scope>runtime</scope>
    </dependency>
    <dependency>
        <groupId>io.netty</groupId>
        <artifactId>netty-resolver-dns-native-macos</artifactId>
        <classifier>osx-aarch_64</classifier>
        <scope>runtime</scope>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
`,
    groovy: `dependencies {
    implementation platform('org.springframework.cloud:spring-cloud-dependencies:2024.0.0')
    implementation('org.springframework.boot:spring-boot-starter-web') {
        exclude group: 'org.springframework.boot', module: 'spring-boot-starter-tomcat'
    }
    implementation 'org.springframework.boot:spring-boot-starter-undertow'
    implementation group: 'org.mapstruct', name: 'mapstruct', version: '1.6.3'
    annotationProcessor 'org.mapstruct:mapstruct-processor:1.6.3'
    compileOnly 'org.projectlombok:lombok'
    annotationProcessor 'org.projectlombok:lombok'
    runtimeOnly 'org.postgresql:postgresql'
    developmentOnly 'org.springframework.boot:spring-boot-devtools'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testRuntimeOnly 'org.junit.platform:junit-platform-launcher'
}
`,
    kotlin: `dependencies {
    implementation(platform("org.springframework.cloud:spring-cloud-dependencies:2024.0.0"))
    implementation("org.springframework.boot:spring-boot-starter-web") {
        exclude(group = "org.springframework.boot", module = "spring-boot-starter-tomcat")
    }
    implementation("org.springframework.boot:spring-boot-starter-undertow")
    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
`,
};

const from = useStorage<BuildFmt>("devtools:maven-gradle-converter:from", "maven");
const to = useStorage<BuildFmt>("devtools:maven-gradle-converter:to", "kotlin");
const input = useStorage("devtools:maven-gradle-converter:input", SAMPLES.maven);
const substitute = useStorage("devtools:maven-gradle-converter:substitute", true);
const wrap = useStorage("devtools:maven-gradle-converter:wrap", true);

const result = computed(() => convertBuild(input.value, from.value, to.value, { substitute: substitute.value, wrap: wrap.value }));
const label = (f: BuildFmt) => fmts.find((x) => x.value === f)!.label;
const wrapLabel = computed(() => (to.value === "maven" ? "Wrap in <dependencies>" : "Wrap in dependencies { }"));
const lang = (f: BuildFmt) => (f === "maven" ? "xml" : "kotlin");

function swap() {
    const r = result.value;
    const f = from.value;
    from.value = to.value;
    to.value = f;
    if (r.out && !r.error) input.value = r.out;
}

async function paste() {
    input.value = await readClipboard();
}

// Input sent from the chat assistant.
useHandoff<{ input?: string; from?: BuildFmt; to?: BuildFmt }>("maven-gradle-converter", (p) => {
    if (p.input != null) {
        input.value = p.input;
        if (!p.from) from.value = /<dependency|<project/.test(p.input) ? "maven" : /\w+\s*\(\s*"/.test(p.input) ? "kotlin" : "groovy";
    }
    if (p.from) from.value = p.from;
    if (p.to) to.value = p.to;
    if (to.value === from.value) to.value = from.value === "maven" ? "kotlin" : "maven";
});
</script>

<template>
    <ToolPage>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label class="flex items-center gap-2">
                <span class="text-muted">From</span>
                <select v-model="from" class="select !w-auto"><option v-for="f in fmts" :key="f.value" :value="f.value">{{ f.label }}</option></select>
            </label>
            <Btn size="sm" variant="secondary" title="Swap formats and move the output to the input" @click="swap"><ArrowLeftRight /> Swap</Btn>
            <label class="flex items-center gap-2">
                <span class="text-muted">To</span>
                <select v-model="to" class="select !w-auto"><option v-for="f in fmts" :key="f.value" :value="f.value">{{ f.label }}</option></select>
            </label>
            <label v-if="from === 'maven'" class="flex items-center gap-2"><input v-model="substitute" type="checkbox" class="checkbox" /> Substitute ${properties}</label>
            <label class="flex items-center gap-2">
                <input v-model="wrap" type="checkbox" class="checkbox" />
                {{ wrapLabel }}
            </label>
            <span v-if="result.count" class="chip">{{ result.count }} declaration{{ result.count === 1 ? "" : "s" }}</span>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel :title="label(from)" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLES[from]"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea
                    v-model="input"
                    :language="lang(from)"
                    :wrap="false"
                    :invalid="!!result.error"
                    height="28rem"
                    :placeholder="from === 'maven' ? 'Paste <dependency> blocks, <dependencies> or a whole pom.xml…' : 'Paste Gradle dependency lines or a dependencies { } block…'"
                />
            </Panel>
            <Panel :title="label(to)" flush>
                <template #actions><CopyButton :text="result.out" /></template>
                <div v-if="result.error" class="p-4"><Notice type="error">{{ result.error }}</Notice></div>
                <CodeArea v-else :model-value="result.out" :language="lang(to)" readonly :wrap="false" height="28rem" placeholder="Output appears here" />
            </Panel>
        </div>

        <Panel v-if="result.notes.length" title="Notes">
            <ul class="list-disc space-y-1 pl-5 text-sm break-words text-fg-muted">
                <li v-for="(n, i) in result.notes" :key="i">{{ n }}</li>
            </ul>
        </Panel>

        <p class="text-xs text-muted">
            Scopes map as compile → implementation, runtime → runtimeOnly, test → testImplementation, provided → compileOnly, and BOM imports → platform(…).
            Lombok becomes compileOnly + annotationProcessor and known processors (MapStruct, configuration processor, JPA metamodel) go to annotationProcessor.
            Exclusions, classifiers, types and optional flags are kept where the target supports them; anything that cannot be converted is listed in the notes.
        </p>
    </ToolPage>
</template>
