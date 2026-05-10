"use client";

import { useEffect } from "react";

const HELP_URL = "https://app.uniq.chat/help/uniqchat";
const COLOR = "#00d46a";

export default function HelpCenterWidget() {
  useEffect(() => {
    const existing = document.getElementById("uniq-help-widget");
    if (existing) return;

    let open = false;

    const btn = document.createElement("button");
    btn.id = "uniq-help-widget";
    btn.innerHTML = "?";
    btn.title = "Central de Ajuda";
    btn.style.cssText =
      "position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:" +
      COLOR +
      ";color:#000;font-size:22px;font-weight:800;border:none;cursor:pointer;box-shadow:0 4px 24px " +
      COLOR +
      "66;z-index:99999;transition:transform 0.2s";
    btn.onmouseenter = () => (btn.style.transform = "scale(1.08)");
    btn.onmouseleave = () => (btn.style.transform = "scale(1)");

    const modal = document.createElement("div");
    modal.style.cssText =
      "display:none;position:fixed;bottom:90px;right:24px;width:400px;height:640px;border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);z-index:99999;";

    const iframe = document.createElement("iframe");
    iframe.src = HELP_URL;
    iframe.style.cssText = "width:100%;height:100%;border:none;";
    modal.appendChild(iframe);

    btn.addEventListener("click", () => {
      open = !open;
      modal.style.display = open ? "block" : "none";
      btn.innerHTML = open ? "✕" : "?";
    });

    document.body.appendChild(btn);
    document.body.appendChild(modal);

    return () => {
      btn.remove();
      modal.remove();
    };
  }, []);

  return null;
}
