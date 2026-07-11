import React from "react";
import { Button } from "@/components/ui/button";
import { DownloadSimple, ArrowSquareOut } from "@phosphor-icons/react";

export default function HelpPage() {
  return (
    <div className="p-8 h-full flex flex-col" data-testid="help-page">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6 shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Support</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Help</h1>
          <div className="text-sm text-slate-500 mt-1">The full Ledgerly user guide — how to set up your business, invite your team, and use every module.</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild data-testid="help-open-tab">
            <a href="/Ledgerly-User-Guide.pdf" target="_blank" rel="noopener noreferrer">
              <ArrowSquareOut size={16} className="mr-2" /> Open in new tab
            </a>
          </Button>
          <Button className="bg-slate-900 hover:bg-slate-800" asChild data-testid="help-download">
            <a href="/Ledgerly-User-Guide.pdf" download="Ledgerly-User-Guide.pdf">
              <DownloadSimple size={16} className="mr-2" /> Download PDF
            </a>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-slate-200 overflow-hidden">
        <object data="/Ledgerly-User-Guide.pdf" type="application/pdf" className="w-full h-full">
          <div className="p-8 text-center text-sm text-slate-500">
            Your browser can't display the guide inline.{" "}
            <a href="/Ledgerly-User-Guide.pdf" className="text-slate-900 underline" target="_blank" rel="noopener noreferrer">Open it in a new tab</a> instead.
          </div>
        </object>
      </div>
    </div>
  );
}
