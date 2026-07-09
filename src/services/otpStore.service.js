const { supabase } = require('../config/supabase');

// In-memory Map as PRIMARY store (fast, always works within same process)
const memoryStore = new Map();

const otpStore = {
    async set(phone, data) {
        // 1. Always save to memory (instant, reliable)
        memoryStore.set(phone, data);
        console.log(`[OTP] SAVED code ${data.code} for phone ${phone} (memory OK)`);
        
        // 2. Also save to Supabase as backup
        try {
            const { error } = await supabase
                .from('whatsapp_sessions')
                .upsert({ id: `otp_${phone}`, data: JSON.stringify(data) });
            if (error) {
                console.error(`[OTP] Supabase save FAILED for ${phone}:`, error.message);
            } else {
                console.log(`[OTP] Supabase save OK for ${phone}`);
            }
        } catch (err) {
            console.error(`[OTP] Supabase save EXCEPTION for ${phone}:`, err.message);
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
                console.log(`[OTP] Supabase get FAILED for ${phone}:`, error.message);
                return null;
            }
            
            if (data && data.data) {
                const parsed = JSON.parse(data.data);
                console.log(`[OTP] FOUND code ${parsed.code} for phone ${phone} (from Supabase)`);
                // Cache in memory for faster next access
                memoryStore.set(phone, parsed);
                return parsed;
            }
        } catch (err) {
            console.error(`[OTP] Supabase get EXCEPTION for ${phone}:`, err.message);
        }
        
        console.log(`[OTP] NOT FOUND for phone ${phone} (checked memory + Supabase)`);
        return null;
    },
    
    async delete(phone) {
        memoryStore.delete(phone);
        try {
            await supabase
                .from('whatsapp_sessions')
                .delete()
                .eq('id', `otp_${phone}`);
        } catch (err) {
            // ignore delete errors
        }
    }
};

otpStore.otpStore = otpStore;
module.exports = otpStore;
