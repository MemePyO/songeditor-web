import re
import os
import sys
from spellchecker import SpellChecker

ROMANIAN_DICT_FILE = "dictionaries/ro_RO.dic"


def resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)


def load_romanian_words(path=ROMANIAN_DICT_FILE):
    words = []
    try:
        with open(resource_path(path), "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                if i == 0 and line.isdigit():
                    continue
                word = line.split("/")[0]
                if word:
                    words.append(word.lower())
    except FileNotFoundError:
        pass
    return words

def get_spellchecker():
    spell = SpellChecker()
    spell.word_frequency.load_words(load_romanian_words())
    return spell


def find_typos(text, spell=None):
    if spell is None:
        spell = get_spellchecker()
    typos = []
    for match in re.finditer(r"[A-Za-zÀ-ȚȘȚțșăâî]+", text):
        word = match.group()
        if word.lower() not in spell:
            typos.append((match.start(), match.end(), word))
    return typos
