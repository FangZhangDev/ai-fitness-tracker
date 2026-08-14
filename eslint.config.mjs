import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 手表端与转发服务不是 Next/React 代码, 这套规则不适用:
    // 蓝河快应用必须用字面量 require(编译器靠静态分析打包 feature),
    // 转发服务是零依赖的独立 Node 脚本。用 Next 的规则扫它们只会刷屏,
    // 把真正该看的告警淹掉。
    "watch/**",
  ]),
]);

export default eslintConfig;
