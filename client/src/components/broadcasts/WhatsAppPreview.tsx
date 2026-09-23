import { Image as ImageIcon, Video, FileText, ExternalLink, Reply, Phone } from "lucide-react";
import { waFormat, type ParsedTemplate } from "../../lib/templates";

/** A phone-style preview of exactly what the recipient will see. */
export default function WhatsAppPreview({
  parsed,
  headerText,
  body,
  mediaUrl,
  businessName,
  contactName,
}: {
  parsed: ParsedTemplate | null;
  headerText: string;
  body: string;
  mediaUrl?: string;
  businessName: string;
  contactName?: string;
}) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const MediaIcon =
    parsed?.headerFormat === "VIDEO" ? Video : parsed?.headerFormat === "DOCUMENT" ? FileText : ImageIcon;

  return (
    <div className="mx-auto w-[300px] rounded-[2.2rem] border-[10px] border-slate-800 bg-slate-800 shadow-xl overflow-hidden">
      <div className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
          {businessName.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{businessName}</div>
          <div className="text-[10px] text-white/70">Business account</div>
        </div>
      </div>

      <div className="bg-[#efeae2] min-h-[380px] max-h-[460px] overflow-y-auto p-3">
        {!parsed ? (
          <p className="text-center text-xs text-slate-500 mt-24 px-6">Choose a template to see the preview</p>
        ) : (
          <div className="bg-white rounded-lg rounded-tl-none shadow-sm max-w-[240px] overflow-hidden">
            {parsed.headerFormat !== "NONE" && parsed.headerFormat !== "TEXT" && (
              <div className="bg-slate-200 aspect-video flex items-center justify-center overflow-hidden">
                {mediaUrl && parsed.headerFormat === "IMAGE" ? (
                  <img src={mediaUrl} alt="" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                ) : (
                  <MediaIcon size={34} className="text-slate-400" />
                )}
              </div>
            )}
            <div className="px-2.5 pt-2 pb-1">
              {headerText && <div className="font-bold text-[13px] mb-1">{headerText}</div>}
              <div
                className="text-[13px] leading-snug text-slate-800 break-words"
                dangerouslySetInnerHTML={{ __html: waFormat(body) }}
              />
              {parsed.footer && <div className="text-[11px] text-slate-400 mt-1.5">{parsed.footer}</div>}
              <div className="text-[10px] text-slate-400 text-right mt-0.5">{time}</div>
            </div>
            {parsed.buttons.map((b, i) => (
              <div key={i} className="border-t border-slate-100 py-2 text-center text-[13px] text-sky-600 font-medium flex items-center justify-center gap-1.5">
                {b.type === "URL" ? <ExternalLink size={13} /> : b.type === "PHONE_NUMBER" ? <Phone size={13} /> : <Reply size={13} />}
                {b.text}
              </div>
            ))}
          </div>
        )}
      </div>
      {contactName && (
        <div className="bg-slate-800 text-[10px] text-slate-400 text-center py-1.5">Previewing as {contactName}</div>
      )}
    </div>
  );
}
