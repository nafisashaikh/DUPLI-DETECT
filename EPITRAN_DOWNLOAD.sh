# Epitran Language Model Download Commands
# Run these once to cache IPA transcription models locally (required for Brain 2 – Phonetic)
# Each command downloads TeX files and builds the transcriber for that language.

# English
python -c "import epitran; epitran.Epitran('eng-Latn'); print('✓ English (eng-Latn) loaded')"

# Arabic
python -c "import epitran; epitran.Epitran('ara-Arab'); print('✓ Arabic (ara-Arab) loaded')"

# Hindi
python -c "import epitran; epitran.Epitran('hin-Deva'); print('✓ Hindi (hin-Deva) loaded')"

# Japanese (Hiragana)
python -c "import epitran; epitran.Epitran('jpn-Hira'); print('✓ Japanese (jpn-Hira) loaded')"

# French
python -c "import epitran; epitran.Epitran('fra-Latn'); print('✓ French (fra-Latn) loaded')"

# German
python -c "import epitran; epitran.Epitran('deu-Latn'); print('✓ German (deu-Latn) loaded')"

# Spanish
python -c "import epitran; epitran.Epitran('spa-Latn'); print('✓ Spanish (spa-Latn) loaded')"

# Turkish
python -c "import epitran; epitran.Epitran('tur-Latn'); print('✓ Turkish (tur-Latn) loaded')"

# Russian (Cyrillic)
python -c "import epitran; epitran.Epitran('rus-Cyrl'); print('✓ Russian (rus-Cyrl) loaded')"

# All languages in one command (bash/zsh):
# for lang in eng-Latn ara-Arab hin-Deva jpn-Hira fra-Latn deu-Latn spa-Latn tur-Latn rus-Cyrl; do \
#   python -c "import epitran; epitran.Epitran('$lang'); print(f'✓ {$lang} loaded')" \
# done

# All languages in one command (Windows PowerShell):
# @('eng-Latn', 'ara-Arab', 'hin-Deva', 'jpn-Hira', 'fra-Latn', 'deu-Latn', 'spa-Latn', 'tur-Latn', 'rus-Cyrl') | ForEach-Object {
#   python -c "import epitran; epitran.Epitran('$_'); print('✓ $_ loaded')"
# }
