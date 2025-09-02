document.addEventListener('DOMContentLoaded', function() {
    const table = document.getElementById('data-table');
    const loadMoreBtn = document.getElementById('load-more');
    const visibleRows = 10; // Show 10 items initially
    const loadMoreCount = 10; // Load 10 more items each time
    let currentVisible = 0;
    let allRows = [];
    let currentSort = { column: -1, direction: 'asc' };
    
    if (!table || !loadMoreBtn) {
        return;
    }

    // Initialize the table
    function initializeTable() {
        // Get all rows including hidden ones
        allRows = Array.from(table.querySelectorAll('.beer-row'));
        
        if (allRows.length === 0) {
            // Try to find any rows as a fallback
            const allTableRows = Array.from(table.querySelectorAll('tbody tr'));
            if (allTableRows.length > 0) {
                allRows = allTableRows;
            }
        }
        
        // Set the initial number of visible rows
        currentVisible = Math.min(visibleRows, allRows.length);
        
        // Set initial sort by sucres column if it exists
        const sucresHeader = Array.from(table.querySelectorAll('th')).find(th => th.getAttribute('data-sort') === 'sucre');
        if (sucresHeader) {
            currentSort.column = Array.from(sucresHeader.parentElement.children).indexOf(sucresHeader);
            currentSort.direction = 'asc';
            sortTable();
        } else {
            // If no specific sort is set, just update visibility
            updateVisibility();
        }
    }
    
    // Sort the table based on current sort settings
    function sortTable(columnIndex = currentSort.column, direction = currentSort.direction) {
        if (columnIndex === -1) return; // No sort column set
        
        const tbody = table.tBodies[0];
        const header = table.rows[0].cells[columnIndex];
        const sortType = header.getAttribute('data-sort-type') || 'text';
        
        // Store the current scroll position and visible count
        const scrollPosition = window.scrollY;
        const currentVisibleCount = currentVisible;
        
        // Get all rows from the DOM and update our allRows array
        allRows = Array.from(tbody.rows);
        
        // Sort all rows
        allRows.sort((a, b) => {
            const aCell = a.cells[columnIndex];
            const bCell = b.cells[columnIndex];
            
            if (sortType === 'number') {
                // Get the raw data-value attribute first
                const aData = aCell.getAttribute('data-value');
                const bData = bCell.getAttribute('data-value');
                
                // Treat null/empty values as Infinity or -Infinity based on direction
                let aValue = (aData === null || aData === '') ? (direction === 'asc' ? Infinity : -Infinity) : parseFloat(aData);
                let bValue = (bData === null || bData === '') ? (direction === 'asc' ? Infinity : -Infinity) : parseFloat(bData);
                if (isNaN(aValue)) aValue = direction === 'asc' ? Infinity : -Infinity;
                if (isNaN(bValue)) bValue = direction === 'asc' ? Infinity : -Infinity;
                return direction === 'asc' ? aValue - bValue : bValue - aValue;
            } else {
                const aValue = (aCell.getAttribute('data-value') || aCell.textContent).trim().toLowerCase();
                const bValue = (bCell.getAttribute('data-value') || bCell.textContent).trim().toLowerCase();
                return direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            }
        });
        
        // Clear and rebuild the table
        while (tbody.firstChild) {
            tbody.removeChild(tbody.firstChild);
        }
        
        // Re-append all rows in the new order
        tbody.append(...allRows);
        
        // Update the allRows array to match the new DOM order
        allRows = Array.from(tbody.rows);
        
        // Update the current visible count to maintain the same number of visible items
        currentVisible = Math.min(currentVisibleCount, allRows.length);
        
        // Update visibility
        updateVisibility();
        
        // Restore scroll position
        window.scrollTo(0, scrollPosition);
        
        // Dispatch a custom event to notify that sorting is complete
        const event = new CustomEvent('tableSorted', {
            detail: {
                column: columnIndex,
                direction: direction,
                totalRows: allRows.length
            }
        });
        table.dispatchEvent(event);
    }
    
    // Update which rows are visible based on currentVisible
    function updateVisibility() {
        // Ensure we don't show more rows than we have
        const visibleCount = Math.min(currentVisible, allRows.length);
        
        // Show/hide rows
        allRows.forEach((row, index) => {
            row.style.display = index < visibleCount ? '' : 'none';
        });
        
        // Update button text and visibility
        if (visibleCount >= allRows.length) {
            loadMoreBtn.style.display = 'none';
        } else {
            const remaining = allRows.length - visibleCount;
            const showCount = Math.min(remaining, loadMoreCount);
            loadMoreBtn.style.display = 'block';
            loadMoreBtn.textContent = `Voir ${showCount} de plus (${remaining} restante${remaining > 1 ? 's' : ''})`;
        }
    }
    
    // Handle header clicks for sorting
    function setupSorting() {
        const headers = table.querySelectorAll('th[data-sort]');
        
        headers.forEach((header, index) => {
            header.style.cursor = 'pointer';
            
            header.addEventListener('click', () => {
                const isSameColumn = currentSort.column === index;
                const newDirection = isSameColumn 
                    ? (currentSort.direction === 'asc' ? 'desc' : 'asc')
                    : 'asc';
                
                // Update sort state
                currentSort = {
                    column: index,
                    direction: newDirection
                };
                
                // Update UI
                headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                header.classList.add(`sort-${newDirection}`);
                
                // Sort the table
                sortTable(index, newDirection);
                
                // Reset to first page when changing sort
                currentVisible = Math.min(visibleRows, allRows.length);
                updateVisibility();
            });
        });
    }
    
    // Load more items
    loadMoreBtn.addEventListener('click', function() {
        currentVisible = Math.min(currentVisible + loadMoreCount, allRows.length);
        updateVisibility();
        
        // Scroll to show the newly loaded items
        if (currentVisible < allRows.length) {
            loadMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
    
        // Initialize everything with a small delay to ensure DOM is fully ready
    setTimeout(() => {
        setupSorting();
        initializeTable();
    }, 100);
});
