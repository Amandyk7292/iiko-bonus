const { supabase } = require('../config/supabase');

// Memory is only a local read-through cache. Supabase remains authoritative so
// OTP verification is consistent across restarts and multiple processes.
const memoryStore = new Map();

const otpStore = {
  async set(phone, data) {
    memoryStore.set(phone, data);
    const { error } = await supabase.from('whatsapp_sessions').upsert({
      id: `otp_${phone}`,
      data,
      expires_at: new Date(data.expires).toISOString(),
    });
    if (error) {
      memoryStore.delete(phone);
      throw new Error(`OTP storage unavailable: ${error.message}`);
    }
  },

  async get(phone) {
    // ALWAYS read from Supabase to ensure cross-instance freshness
    // This solves the stale cache bug when zero-downtime deploy runs 2 instances
    try {
      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('data')
        .eq('id', `otp_${phone}`)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data && data.data) {
        const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        // Cache in memory for faster next access
        memoryStore.set(phone, parsed);
        return parsed;
      }
    } catch (error) {
      throw new Error(`OTP storage unavailable: ${error.message}`, { cause: error });
    }

    return null;
  },

  async delete(phone) {
    memoryStore.delete(phone);
    const { error } = await supabase.from('whatsapp_sessions').delete().eq('id', `otp_${phone}`);
    if (error) throw new Error(`OTP storage unavailable: ${error.message}`);
  },

  async consume(phone, code) {
    const { data, error } = await supabase.rpc('consume_whatsapp_otp', {
      p_phone: String(phone || ''),
      p_code: String(code || ''),
    });
    if (error) throw new Error(`OTP storage unavailable: ${error.message}`);
    if (data?.status === 'success' || data?.status === 'expired') memoryStore.delete(phone);
    return data || { status: 'expired' };
  },
};

otpStore.otpStore = otpStore;
module.exports = otpStore;
