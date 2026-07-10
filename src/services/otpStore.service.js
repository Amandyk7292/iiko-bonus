const { supabase } = require('../config/supabase');

// In-memory Map as PRIMARY store (fast, always works within same process)
const memoryStore = new Map();

const otpStore = {
  async set(phone, data) {
    // 1. Always save to memory (instant, reliable)
    memoryStore.set(phone, data);

    // 2. Also save to Supabase as backup
    try {
      const { error } = await supabase.from('whatsapp_sessions').upsert({
        id: `otp_${phone}`,
        data: JSON.stringify(data),
        expires_at: new Date(data.expires).toISOString(),
      });
      if (error) {
        console.error('[OTP] Supabase save failed:', error.message);
      }
    } catch (err) {
      console.error('[OTP] Supabase save exception:', err.message);
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

      if (error) {
        console.log('[OTP] Supabase get failed:', error.message);
        return null;
      }

      if (data && data.data) {
        const parsed = JSON.parse(data.data);
        // Cache in memory for faster next access
        memoryStore.set(phone, parsed);
        return parsed;
      }
    } catch (err) {
      console.error('[OTP] Supabase get exception:', err.message);
    }

    return null;
  },

  async delete(phone) {
    memoryStore.delete(phone);
    try {
      await supabase.from('whatsapp_sessions').delete().eq('id', `otp_${phone}`);
    } catch (_err) {
      // ignore delete errors
    }
  },
};

otpStore.otpStore = otpStore;
module.exports = otpStore;
