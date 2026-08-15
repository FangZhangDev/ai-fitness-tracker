import { getCurrentUser } from "@/lib/utils/server";
import { resolveAiConfig } from "@/lib/ai/client";
import { presetViews } from "@/lib/actions/settings";
import { SectionTitle } from "@/components/ui";
import AiSettings from "@/components/ai-settings";

export const dynamic = "force-dynamic";

/** 与 actions/settings.ts 里的 maskKey 一致; "use server" 文件不能导出同步函数, 只好放两份 */
function maskKey(key: string): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export default async function SettingsPage() {
  // getCurrentUser 在 presetViews 内部也会调, 这里显式调用一次以校验登录
  // (页面本身被 proxy 保护, 属双保险)
  await getCurrentUser();
  const [presets, cfg] = await Promise.all([presetViews(), resolveAiConfig()]);
  const active = presets.find((p) => p.isActive);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="设置"
        desc="AI 供应商与密钥：保存多套配置，随时切换，不必再改环境变量重新部署"
      />
      <AiSettings
        presets={presets}
        effective={{
          source: active ? `预设「${active.name}」` : "环境变量",
          baseUrl: cfg.baseURL,
          model: cfg.model,
          keyMasked: maskKey(cfg.apiKey),
          jsonMode: cfg.jsonMode,
          temperature: cfg.temperature,
          tools: cfg.tools,
        }}
      />
    </div>
  );
}
