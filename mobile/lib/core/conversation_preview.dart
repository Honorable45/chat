import '../models/conversation.dart';

/// Port simplifié de `preview()` dans `frontend/src/components/chat/ConversationList.tsx`
/// — les types sans écran dédié pour l'instant (appel, vocal, média...)
/// gardent un aperçu générique à une ligne plutôt que la logique complète
/// (durée d'appel, texte système détaillé...), à enrichir au fur et à
/// mesure que ces écrans arrivent côté mobile.
String conversationPreview(Conversation conversation, String myUserId) {
  final last = conversation.lastMessage;
  if (last == null) return 'Démarrez la conversation !';
  final prefix = last.senderId == myUserId ? 'Vous : ' : '';
  switch (last.type) {
    case 'SYSTEM':
      return 'Le groupe a été mis à jour';
    case 'VOICE':
      return '$prefix🎤 Message vocal';
    case 'IMAGE':
      return '$prefix📷 Photo';
    case 'VIDEO':
      return '$prefix🎥 Vidéo';
    case 'MEDIA_ALBUM':
      return '$prefix📷 Médias';
    case 'CALL':
      return '$prefix📞 Appel';
    case 'GROUP_CALL':
      return '$prefix📞 Appel de groupe';
    case 'CONTACT_SHARE':
      return '$prefix👤 Contact partagé';
    case 'LOCATION':
      return '$prefix📍 Position';
    default:
      return '$prefix${last.text ?? ''}';
  }
}

bool isMissedCallForMe(ConversationLastMessage last, String myUserId) =>
    last.type == 'CALL' && last.senderId != myUserId;
