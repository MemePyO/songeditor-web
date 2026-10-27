import json

import presentation_pb2
from SongEditorPro7Generic import gen_pro_data


def gen_single_pro(block_name, song_texts, line_count, arrangement_order=None,
                   remove_other_blocks=True):
    """Generate a .pro containing only `block_name`'s text block.

    Reuses the standard generator, then (optionally) prunes every text
    element whose name differs from `block_name` so the exported
    presentation has no other language text block at all.
    """
    raw = gen_pro_data(
        [block_name], song_texts, line_count,
        arrangement_order=arrangement_order,
    )

    if not remove_other_blocks:
        return raw

    presentation_obj = presentation_pb2.Presentation()
    presentation_obj.ParseFromString(raw)

    for cue in presentation_obj.cues:
        for action in cue.actions:
            base_slide = action.slide.presentation.base_slide
            keep = [el for el in base_slide.elements
                    if el.element.name == block_name]
            del base_slide.elements[:]
            base_slide.elements.extend(keep)

    return presentation_obj.SerializeToString()


def save_single(block_name, song_texts, line_count, output_filename,
                arrangement_order=None):
    """Write `<output_filename>.json` and `<output_filename>.pro` using only
    the single `block_name` text block."""
    with open(output_filename + ".json", "w", encoding="utf-8") as f:
        json.dump(song_texts, f, ensure_ascii=False, indent=2)

    with open(output_filename + ".pro", "wb") as f:
        f.write(gen_single_pro(
            block_name, song_texts, line_count,
            arrangement_order=arrangement_order,
        ))
