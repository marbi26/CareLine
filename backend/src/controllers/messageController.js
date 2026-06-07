// backend/src/controllers/messageController.js
import { Patient, Doctor, Admin, Support, Appointment, Message } from '../models.js';

export async function getContacts(req, res) {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: 'Missing userId' });

  try {
    // 1. Find all appointments involving this user
    const appts = await Appointment.find({
      $or: [
        { patientId: userId },
        { doctorId: userId },
        { clinicId: userId }
      ]
    });

    const contactIds = new Set();
    appts.forEach(a => {
      if (a.patientId && String(a.patientId) !== userId) contactIds.add(String(a.patientId));
      if (a.doctorId && String(a.doctorId) !== userId) contactIds.add(String(a.doctorId));
      if (a.clinicId && String(a.clinicId) !== userId) contactIds.add(String(a.clinicId));
    });

    // 2. Find all message exchange partners
    const messages = await Message.find({
      $or: [
        { senderId: userId },
        { receiverId: userId }
      ]
    });

    messages.forEach(m => {
      if (m.senderId && String(m.senderId) !== userId) contactIds.add(String(m.senderId));
      if (m.receiverId && String(m.receiverId) !== userId) contactIds.add(String(m.receiverId));
    });

    // 3. Resolve each contact's details in parallel
    const contacts = [];
    for (const id of contactIds) {
      const [patient, doctor, admin, support] = await Promise.all([
        Patient.findById(id),
        Doctor.findById(id),
        Admin.findById(id),
        Support.findById(id)
      ]);
      const user = patient || doctor || admin || support;
      if (!user) continue;

      // Get last message between user and contact
      const lastMsg = await Message.findOne({
        $or: [
          { senderId: userId, receiverId: id },
          { senderId: id, receiverId: userId }
        ]
      }).sort({ createdAt: -1 });

      // Get unread count sent by contact to user
      const unreadCount = await Message.countDocuments({
        senderId: id,
        receiverId: userId,
        read: false
      });

      let subLabel = '';
      if (user.role === 'doctor') {
        subLabel = user.profile?.specialization || 'Doctor';
      } else if (user.role === 'admin') {
        subLabel = user.profile?.clinicName || 'Clinic Admin';
      } else if (user.role === 'support') {
        subLabel = user.profile?.department || 'Support Staff';
      } else {
        subLabel = 'Patient';
      }

      contacts.push({
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        subLabel,
        lastMessage: lastMsg ? {
          content: lastMsg.content,
          createdAt: lastMsg.createdAt
        } : null,
        unreadCount
      });
    }

    // Sort contacts by last message time (most recent first)
    contacts.sort((a, b) => {
      const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    res.json({ contacts });
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ message: 'Failed to load contacts' });
  }
}

export async function getChatHistory(req, res) {
  const { user1, user2, viewerId } = req.query;
  if (!user1 || !user2) {
    return res.status(400).json({ message: 'Missing user1 or user2' });
  }

  try {
    // If viewerId is specified, mark messages from the other user to the viewer as read
    if (viewerId) {
      const senderId = viewerId === user1 ? user2 : user1;
      const receiverId = viewerId;
      await Message.updateMany(
        { senderId, receiverId, read: false },
        { $set: { read: true } }
      );
    }

    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    }).sort({ createdAt: 1 });

    res.json({ messages });
  } catch (err) {
    console.error('Error fetching chat history:', err);
    res.status(500).json({ message: 'Failed to load chat history' });
  }
}

export async function sendMessage(req, res) {
  const { senderId, receiverId, content } = req.body;
  if (!senderId || !receiverId || !content) {
    return res.status(400).json({ message: 'Missing senderId, receiverId, or content' });
  }

  try {
    const message = new Message({
      senderId,
      receiverId,
      content
    });
    await message.save();

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ message: 'Failed to send message' });
  }
}
