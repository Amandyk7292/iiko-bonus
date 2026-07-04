const { supabase } = require('./supabase');

const otpStore = {
    async set(phone, data) {
        try {
            await supabase
                .from('whatsapp_sessions')
                .upsert({ id: `otp_${phone}`, data: JSON.stringify(data) });
        } catch (err) {
            console.error('Error saving OTP to Supabase:', err);
        }
    },
    async get(phone) {
        try {
            const { data } = await supabase
                .from('whatsapp_sessions')
                .select('data')
                .eq('id', `otp_${phone}`)
                .single();
            if (data && data.data) {
                return JSON.parse(data.data);
            }
            return null;
        } catch (err) {
            return null;
        }
    },
    async delete(phone) {
        try {
            await supabase
                .from('whatsapp_sessions')
                .delete()
                .eq('id', `otp_${phone}`);
        } catch (err) {
            console.error('Error deleting OTP:', err);
        }
    }
};

module.exports = { otpStore };
