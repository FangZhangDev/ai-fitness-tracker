"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

/**
 * 全量导出。
 * 主推「复制到剪贴板」: 直接粘进 ChatGPT / Claude 的对话框, 不用管文件上传。
 */
export default function BundleExport() {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);

  async function copyMarkdown() {
    setCopying(true);
    setErr(null);
    setCopied(false);
    try {
      const res = await fetch("/api/export?bundle=md");
      if (!res.ok) throw new Error(`导出失败 (${res.status})`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setSize(text.length);
      setCopied(true);
    } catch (e) {
      // 剪贴板 API 在非 HTTPS 页面会被浏览器禁用, 这时提示改用下载
      setErr(
        e instanceof Error && e.name === "NotAllowedError"
          ? "浏览器不允许写剪贴板（http 页面常见），请改用下面的「下载 .md」"
          : e instanceof Error
            ? e.message
            : "复制失败",
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium">一键导出全部数据</div>
      <p className="mt-1 text-sm text-neutral-500">
        含个人档案、训练计划、身体指标、饮食、训练记录、PR 与历史分析。
        导出内容里已经带好了<strong>数据字典</strong>和<strong>给 AI 的提示词</strong>，
        对方不用猜字段含义。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={copyMarkdown} disabled={copying} className="btn btn-primary">
          {copying ? "生成中…" : "复制全部数据到剪贴板"}
        </button>
        <a href="/api/export?bundle=md" className="btn btn-ghost border border-neutral-200 dark:border-neutral-800">
          下载 .md
        </a>
        <a href="/api/export?bundle=zip" className="btn btn-ghost border border-neutral-200 dark:border-neutral-800">
          下载 .zip
        </a>
        <a href="/api/export?bundle=json" className="btn btn-ghost border border-neutral-200 dark:border-neutral-800">
          下载 .json
        </a>
      </div>

      {copied && (
        <div className="mt-2 text-sm text-emerald-600">
          已复制（约 {size?.toLocaleString()} 字符）。直接粘进 ChatGPT / Claude 的对话框就行。
        </div>
      )}
      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}

      <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-800/50">
        <div className="font-medium text-neutral-600 dark:text-neutral-300">怎么用</div>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>点上面的「复制全部数据」，粘进 ChatGPT / Claude 的对话框发送</li>
          <li>它会按导出内容里约定的格式回你分析和建议</li>
          <li>如果它给了新的训练计划，把回复整段复制</li>
          <li>
            到「训练计划 → 粘贴导入」里粘上去，本系统的 AI 会把它转成结构化计划，
            确认后直接生效
          </li>
        </ol>
        <div className="mt-2">
          三种文件的区别：<code>.md</code> 单文件，粘贴或上传都方便，一般用它就够；
          <code>.zip</code> 里是各表 CSV 加说明文档，适合做备份；
          <code>.json</code> 是机器可读的完整结构。
        </div>
      </div>
    </Card>
  );
}
