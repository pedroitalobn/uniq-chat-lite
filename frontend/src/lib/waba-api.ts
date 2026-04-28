import api from "./api";
import type { WABAInstance } from "@/types";

export interface WABAPhoneNumber {
  display_name: string;
  code: string;
  verified_name: string;
  status: string;
}

export interface WABAMessageRequest {
  to: string;
  body: string;
}

const wabaApi = {
  getAuthURL: async () => {
    const res = await api.get<{ auth_url: string }>("/v1/waba/auth-url");
    return res.data;
  },

  callback: async (code: string) => {
    const res = await api.post<{ instance: { id: string } }>("/v1/waba/callback", { code });
    return res.data;
  },

  getWABA: async (instanceId: string) => {
    const res = await api.get<{ data: WABAInstance }>(`/v1/instances/${instanceId}/waba`);
    return res.data;
  },

  deleteWABA: async (instanceId: string) => {
    const res = await api.delete(`/v1/instances/${instanceId}/waba`);
    return res.data;
  },

  listPhoneNumbers: async (instanceId: string) => {
    const res = await api.get<{ phone_numbers: WABAPhoneNumber[] }>(`/v1/instances/${instanceId}/waba/phone-numbers`);
    return res.data;
  },

  sendMessage: async (instanceId: string, data: WABAMessageRequest) => {
    const res = await api.post(`/v1/instances/${instanceId}/waba/messages`, data);
    return res.data;
  },
};

export default wabaApi;
