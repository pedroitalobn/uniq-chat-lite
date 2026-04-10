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
    const res = await api.get<{ auth_url: string }>("/waba/auth-url");
    return res.data;
  },

  callback: async (code: string) => {
    const res = await api.post<{ instance: { id: string } }>("/waba/callback", { code }, {
      params: { code },
    });
    return res.data;
  },

  getWABA: async (instanceId: string) => {
    const res = await api.get<{ data: WABAInstance }>(`/instances/${instanceId}/waba`);
    return res.data;
  },

  deleteWABA: async (instanceId: string) => {
    const res = await api.delete(`/instances/${instanceId}/waba`);
    return res.data;
  },

  listPhoneNumbers: async (instanceId: string) => {
    const res = await api.get<{ phone_numbers: WABAPhoneNumber[] }>(`/instances/${instanceId}/waba/phone-numbers`);
    return res.data;
  },

  sendMessage: async (instanceId: string, data: WABAMessageRequest) => {
    const res = await api.post(`/instances/${instanceId}/waba/messages`, data);
    return res.data;
  },
};

export default wabaApi;