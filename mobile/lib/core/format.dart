/// Équivalent de `frontend/src/lib/format.ts` — pas de
/// `Intl.RelativeTimeFormat` direct en Dart, ce petit calcul manuel produit
/// un résultat visuellement équivalent ("à l'instant", "5 min", "2 h"...).
String shortRelativeTime(DateTime? date) {
  if (date == null) return '';
  final diff = date.difference(DateTime.now());
  final abs = diff.abs();

  if (abs.inSeconds < 60) return "à l'instant";
  if (abs.inMinutes < 60) return '${abs.inMinutes} min';
  if (abs.inHours < 24) return '${abs.inHours} h';
  if (abs.inDays < 7) return '${abs.inDays} j';
  if (abs.inDays < 30) return '${(abs.inDays / 7).floor()} sem.';
  if (abs.inDays < 365) return '${(abs.inDays / 30).floor()} mois';
  return '${(abs.inDays / 365).floor()} an';
}

String timeOfDay(DateTime date) {
  final d = date.toLocal();
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}
