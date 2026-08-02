const cleanSupportResolution = (value) =>
  String(value || '')
    .trim()
    .slice(0, 2000);

function determineSupportClosure(latestMessage, explicitResolution) {
  const draft = cleanSupportResolution(explicitResolution);
  const senderType = latestMessage?.sender_type || latestMessage?.senderType || '';
  const internal = latestMessage?.is_internal === true || latestMessage?.internal === true;
  const existingReply =
    senderType === 'admin' && !internal ? cleanSupportResolution(latestMessage?.body) : '';

  if (draft) {
    return {
      resolution: draft,
      addMessage: !existingReply || existingReply !== draft,
    };
  }
  if (existingReply) {
    return {
      resolution: existingReply,
      addMessage: false,
    };
  }
  return null;
}

module.exports = {
  cleanSupportResolution,
  determineSupportClosure,
};
