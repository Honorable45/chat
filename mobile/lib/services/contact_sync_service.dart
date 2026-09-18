import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/public_user.dart';
import 'api_client.dart';

const _batchSize = 500;
const _prefKey = 'glotta.contactSync.enabled';

/// Synchronisation des contacts téléphoniques (section 2) — retrouve les
/// contacts déjà inscrits sur Glotta sans jamais faire quitter l'appareil à
/// un numéro en clair : seuls des hashs SHA-256 sont envoyés (voir
/// ContactsController.matchPhones côté backend, qui compare à
/// User.phoneHash). Explicitement opt-in (préférence locale, jamais activée
/// par défaut) — voir AddContactSheet.
class ContactSyncService {
  ContactSyncService._();
  static final ContactSyncService instance = ContactSyncService._();

  Future<bool> get isEnabled async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefKey) ?? false;
  }

  Future<void> setEnabled(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefKey, value);
  }

  Future<bool> hasPermission() => FlutterContacts.permissions.has(PermissionType.read);

  Future<bool> requestPermission() async {
    final status = await FlutterContacts.permissions.request(PermissionType.read);
    return status == PermissionStatus.granted || status == PermissionStatus.limited;
  }

  /// Lit le carnet d'adresses, hash chaque numéro localement, et interroge
  /// le backend par lots. Ne normalise que ce qui l'est déjà de façon fiable
  /// (voir `_hashesFor`) — un numéro local mal deviné produirait un hash qui
  /// ne correspondrait simplement à personne, jamais une erreur silencieuse
  /// plus grave.
  Future<List<PublicUser>> sync() async {
    final contacts = await FlutterContacts.getAll(properties: {ContactProperty.phone});
    final hashes = <String>{};
    for (final contact in contacts) {
      for (final phone in contact.phones) {
        final hash = _hashPhone(phone);
        if (hash != null) hashes.add(hash);
      }
    }
    if (hashes.isEmpty) return [];

    final results = <PublicUser>[];
    final all = hashes.toList();
    for (var i = 0; i < all.length; i += _batchSize) {
      final batch = all.sublist(i, i + _batchSize > all.length ? all.length : i + _batchSize);
      final matched = await ApiClient.instance.matchPhones(batch);
      results.addAll(matched);
    }
    return results;
  }

  /// `null` si le numéro n'est pas déjà dans un format international fiable
  /// (voir Phone.normalizedNumber, fourni par l'OS sur Android ; sur iOS ou
  /// à défaut, seuls les numéros déjà saisis avec un `+` sont retenus).
  String? _hashPhone(Phone phone) {
    final normalized = phone.normalizedNumber?.trim();
    final raw = phone.number.trim();
    final candidate = (normalized != null && normalized.startsWith('+'))
        ? normalized
        : (raw.startsWith('+') ? raw : null);
    if (candidate == null) return null;
    final digitsOnly = '+${candidate.replaceAll(RegExp(r'[^0-9]'), '')}';
    if (digitsOnly.length < 8) return null;
    return sha256.convert(utf8.encode(digitsOnly)).toString();
  }
}
