import os
import datetime
import pathlib # Added for path manipulation in is_excluded

# --- Configuration ---
PATHS_FILE_NAME = "paths.txt"
OUTPUT_FILE_NAME = "extracted_code.txt"
# Folders to exclude (case-insensitive checking will be done)
# We will check if any directory name in a file's path is EQUAL to one of these (after converting to lowercase)
EXCLUDE_FOLDERS_EXACT = {".vs", "obj", "properties"} # Use a set of lowercase strings
# --- End Configuration ---

def is_excluded(file_path):
    """
    Checks if the file_path should be excluded based on EXCLUDE_FOLDERS_EXACT.
    It checks if any directory component in the file_path matches an excluded folder name (case-insensitive).
    """
    path_obj = pathlib.Path(file_path)
    # Iterate over all directory parts of the path
    # path_obj.parts might be ('C:', 'Users', 'name', 'file.txt') or ('/', 'home', 'user', 'file.txt')
    # We are interested in 'Users', 'name' etc. not the drive letter or root '/' or the filename itself.
    for part in path_obj.parts[:-1]: # All parts of the path except the filename itself
        if part.lower() in EXCLUDE_FOLDERS_EXACT:
            return True
    return False

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    paths_file_full_path = os.path.join(script_dir, PATHS_FILE_NAME)
    output_file_full_path = os.path.join(script_dir, OUTPUT_FILE_NAME)

    if not os.path.exists(paths_file_full_path):
        print(f"ERROR: Input file '{PATHS_FILE_NAME}' not found in script directory:\n{script_dir}")
        return

    file_paths_to_extract = []
    projects_to_scan = []  # List of dicts: {'path': str, 'extensions': set} for directory scanning
    project_roots_for_header_set = set() # Unique project roots or parent dirs of direct files for output header
    # NEW: Set to store absolute paths that should be completely excluded.
    excluded_paths_from_none = set()

    print("Reading paths and target extensions from:", paths_file_full_path)
    with open(paths_file_full_path, 'r', encoding='utf-8') as pf:
        for line_num, line_content in enumerate(pf, 1):
            stripped_line = line_content.strip()
            if not stripped_line:  # Skip empty lines
                continue

            parts = [p.strip() for p in stripped_line.split(',')]
            project_path_raw = parts[0]
            
            if not project_path_raw: # Path part is empty
                print(f"WARNING: Empty path on line {line_num} in '{PATHS_FILE_NAME}'. Skipping...")
                continue

            project_path_normalized = os.path.abspath(project_path_raw)
            
            # NEW: Check for the "none" exclusion keyword first.
            specified_ext_keywords = [kw.lower() for kw in parts[1:]]
            if "none" in specified_ext_keywords:
                if os.path.exists(project_path_normalized):
                    print(f"  Exclusion rule found: Path '{project_path_normalized}' and its contents will be excluded.")
                    excluded_paths_from_none.add(project_path_normalized)
                else:
                    # Still add the rule even if path doesn't exist, in case it's a pattern for a generated path
                    print(f"  Exclusion rule found for non-existent path: '{project_path_normalized}'. Rule will be applied.")
                    excluded_paths_from_none.add(project_path_normalized)
                continue # This line's purpose is exclusion, so we're done with it.


            if os.path.isdir(project_path_normalized):
                project_roots_for_header_set.add(project_path_normalized)
                current_extensions = set()
                # parts[0] is the path, parts[1:] are the extension keywords
                # specified_ext_keywords was already calculated above

                if not specified_ext_keywords: # Only path was given (e.g., "C:\MyProject")
                    current_extensions.add(".cs") # Default to .cs
                else:
                    has_valid_keyword = False
                    for ext_keyword in specified_ext_keywords:
                        if ext_keyword:  # Ensure keyword is not an empty string
                            current_extensions.add("." + ext_keyword) # Prepend dot
                            has_valid_keyword = True
                    
                    if not has_valid_keyword:
                        # All specified keywords were empty (e.g., "path, ,,")
                        print(f"WARNING: Directory path '{project_path_raw}' (line {line_num}) had extension specifiers "
                              f"({', '.join(parts[1:])}), but all were empty after processing. "
                              "No files will be searched in this directory for this line's configuration.")
                
                if current_extensions: # Only add to scan if there are extensions to look for
                    projects_to_scan.append({'path': project_path_normalized, 'extensions': current_extensions})

            elif os.path.isfile(project_path_normalized):
                # This is a direct file path
                parent_dir = os.path.dirname(project_path_normalized)
                project_roots_for_header_set.add(parent_dir) # Add parent dir for header grouping

                # Check extensions if provided for this specific file
                # Filter out empty strings from parts[1:] that might result from "path, , ext"
                raw_ext_keywords_for_file = [kw for kw in parts[1:] if kw] 
                
                should_add_file = False
                if not raw_ext_keywords_for_file:
                    # No extension keywords specified for this file (e.g. "path/file.txt" or "path/file.txt,,")
                    # -> include the file by default
                    should_add_file = True
                else:
                    # Extension keywords were specified. File's extension must match one of them.
                    file_actual_ext_lower_with_dot = os.path.splitext(project_path_normalized.lower())[1]
                    target_extensions_for_file = {"." + kw.lower() for kw in raw_ext_keywords_for_file}

                    if file_actual_ext_lower_with_dot in target_extensions_for_file:
                        should_add_file = True
                    else:
                        print(f"INFO: Direct file '{project_path_raw}' (line {line_num}) with extension '{file_actual_ext_lower_with_dot}' "
                              f"skipped. It does not match specified target extensions: {', '.join(sorted(list(target_extensions_for_file)))}.")
                
                if should_add_file:
                    if not is_excluded(project_path_normalized):
                        file_paths_to_extract.append(project_path_normalized)
                        print(f"  Will extract (direct file): {project_path_normalized}")
                    else:
                        print(f"  Skipping excluded direct file (path contains excluded folder name): {project_path_normalized}")
            
            else: # Not a directory and not a file
                print(f"WARNING: Path not found or not a valid file/directory: '{project_path_raw}' (from line {line_num}). Skipping...")
                continue

    # Sort directory scan list for consistent processing order
    projects_to_scan.sort(key=lambda p: p['path'])
    
    # Prepare sorted lists of root paths for header and grouping
    # For displaying in the output file's initial header (alphabetical)
    header_display_roots = sorted(list(project_roots_for_header_set))
    # For grouping files under project root headers (longest path first, then alphabetical for tie-break)
    grouping_roots = sorted(list(project_roots_for_header_set), key=lambda p: (-len(os.path.normpath(p)), os.path.normpath(p)))

    # --- Process directories specified in projects_to_scan ---
    for proj_spec in projects_to_scan:
        project_path = proj_spec['path']
        allowed_extensions = proj_spec['extensions']

        if not allowed_extensions: # Should have been caught by warning and not added if empty
            continue 
        
        print(f"--- Processing Project Directory: '{project_path}' for extensions: {', '.join(sorted(list(allowed_extensions)))} ---")

        for root, dirs, files in os.walk(project_path, topdown=True):
            # NEW: Check if the current directory (root) is under a path marked with "none".
            norm_root = os.path.normpath(root)
            is_root_excluded_by_none = False
            for excluded_path in excluded_paths_from_none:
                norm_excluded_path = os.path.normpath(excluded_path)
                if norm_root == norm_excluded_path or norm_root.startswith(norm_excluded_path + os.sep):
                    is_root_excluded_by_none = True
                    break
            
            if is_root_excluded_by_none:
                print(f"  Skipping excluded directory and its contents (rule: 'none'): {root}")
                dirs[:] = []  # Prune subdirectories from os.walk
                continue      # Skip processing files in this root

            # Filter directories in-place to prevent traversing into excluded ones
            dirs[:] = [d for d in dirs if d.lower() not in EXCLUDE_FOLDERS_EXACT]

            for file in files:
                file_ext_lower = os.path.splitext(file.lower())[1]
                if file_ext_lower in allowed_extensions:
                    file_full_path = os.path.join(root, file)
                    # is_excluded checks the full path components, redundant if dirs[:] already pruned, but good for safety.
                    if not is_excluded(file_full_path):
                        file_paths_to_extract.append(file_full_path)
                        print(f"  Will extract: {file_full_path}")
                    # else: # Optional: print if a file found by walk is excluded by path component
                    #    print(f"  Skipping excluded file (found by walk, path component): {file_full_path}")


    # Sort all collected file paths for consistent output order
    file_paths_to_extract.sort()

    # NEW: Final filtering pass to remove any files that fall under a 'none' exclusion rule.
    # This handles direct file paths and is a final safeguard.
    final_file_paths = []
    for file_path in file_paths_to_extract:
        is_file_excluded_by_none = False
        norm_file_path = os.path.normpath(file_path)
        for excluded_path in excluded_paths_from_none:
            norm_excluded_path = os.path.normpath(excluded_path)
            if norm_file_path == norm_excluded_path or norm_file_path.startswith(norm_excluded_path + os.sep):
                is_file_excluded_by_none = True
                print(f"  Filtering out file due to 'none' exclusion rule: {file_path}")
                break
        if not is_file_excluded_by_none:
            final_file_paths.append(file_path)
    
    file_paths_to_extract = final_file_paths


    print(f"\nWriting extracted code to: {output_file_full_path}")
    with open(output_file_full_path, 'w', encoding='utf-8') as out_f:
        out_f.write(f"Python Script: {os.path.basename(__file__)}\n")
        out_f.write(f"Date: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        out_f.write(f"Source Paths File: {paths_file_full_path}\n")
        # Optionally, list the processed roots:
        if header_display_roots:
            out_f.write("Processed Roots (Directories from paths.txt or Parent Directories of files from paths.txt):\n")
            for r_path in header_display_roots:
                out_f.write(f"- {r_path}\n")
        out_f.write("========================================\n\n")

        if not project_roots_for_header_set and not file_paths_to_extract: # No valid paths processed at all
             out_f.write("No project paths or direct files were processed from paths.txt (or all were invalid/empty).\n")
        elif not file_paths_to_extract: # Roots were processed, but no files matched
             out_f.write(f"Processed paths from '{PATHS_FILE_NAME}' but found no files matching the criteria.\n")


        last_project_root_written = None

        for extracted_file_path in file_paths_to_extract:
            current_project_root = ""
            # Find the project root this file belongs to from the list of roots we processed (sorted by length desc)
            for pr_header_path in grouping_roots:
                # Check if the file path starts with the project root path.
                # Add os.sep to ensure it's a directory match, not partial name.
                # os.path.normpath ensures consistent separators for comparison
                norm_extracted_path = os.path.normpath(extracted_file_path)
                norm_pr_header_path = os.path.normpath(pr_header_path)

                if norm_extracted_path.startswith(norm_pr_header_path + os.sep) or \
                   os.path.dirname(norm_extracted_path) == norm_pr_header_path : # for files directly in root
                    current_project_root = pr_header_path # Use original pr_header_path for display
                    break
            
            if current_project_root and current_project_root != last_project_root_written:
                out_f.write(f"\n--- Files from Project Root: {current_project_root} ---\n\n")
                last_project_root_written = current_project_root
            elif not current_project_root and last_project_root_written is None and grouping_roots:
                # Fallback if a file's root isn't perfectly matched but we have roots
                out_f.write(f"\n--- Files from Uncategorized Project Root (check paths.txt and script logic) ---\n\n")
                last_project_root_written = "UNCATEGORIZED" # Prevent this header from repeating

            out_f.write(f"// ==================================================\n")
            out_f.write(f"// FILE: {extracted_file_path}\n")
            out_f.write(f"// ==================================================\n\n")
            try:
                with open(extracted_file_path, 'r', encoding='utf-8', errors='replace') as f_content:
                    out_f.write(f_content.read())
                out_f.write("\n\n")
            except Exception as e:
                out_f.write(f"// ERROR: Could not read file. Reason: {e}\n\n")
                print(f"    WARNING: Error reading file '{extracted_file_path}'. Reason: {e}")
    
    # Final console messages
    if not project_roots_for_header_set: # No valid entries in paths.txt
        print(f"No valid project paths or direct files were found in '{PATHS_FILE_NAME}'. "
              f"Output file '{OUTPUT_FILE_NAME}' may only contain a basic header.")
    elif not file_paths_to_extract: # Valid paths/roots, but no files matched criteria
        print(f"Processed paths from '{PATHS_FILE_NAME}' but found no files matching the extraction criteria. "
              f"Output file '{OUTPUT_FILE_NAME}' written with header and relevant messages.")
    else: # Files were extracted
        print(f"Extraction complete. Output written to '{OUTPUT_FILE_NAME}'.")

if __name__ == "__main__":
    main()