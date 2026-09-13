class LanguageSummary {
  final String code;
  final String name;
  final String nativeName;

  const LanguageSummary({required this.code, required this.name, required this.nativeName});

  factory LanguageSummary.fromJson(Map<String, dynamic> json) => LanguageSummary(
        code: json['code'] as String,
        name: json['name'] as String,
        nativeName: json['nativeName'] as String,
      );
}
