// Wait for the page to fully load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing table sort...');
    
    // Get the table by ID
    const table = document.getElementById('data-table');
    if (!table) {
        console.error('Error: Table with ID "data-table" not found');
        return;
    }
    
    console.log('Table found, initializing sort...');
    
    // Add click handlers to all sortable table headers
    const headers = table.querySelectorAll('th[data-sort]');
    let currentSort = { column: -1, isAsc: true };
    
    // Find the Sucres column index
    const sucresHeader = Array.from(headers).find(header => 
        header.getAttribute('data-sort') === 'sucre'
    );
    
    // Auto-sort by Sucres in ascending order on page load
    if (sucresHeader) {
        const columnIndex = sucresHeader.cellIndex;
        currentSort = { column: columnIndex, isAsc: true };
        sucresHeader.classList.add('sort-asc');
        sortTable(table, columnIndex, 'asc');
    }
    
    headers.forEach((header, index) => {
        // Add cursor pointer
        header.style.cursor = 'pointer';
        
        // Add click handler
        header.addEventListener('click', function() {
            // Check if clicking the same column
            const isSameColumn = currentSort.column === index;
            
            // Toggle direction if same column, otherwise default to ascending
            const newIsAsc = isSameColumn ? !currentSort.isAsc : true;
            
            // Update current sort state
            currentSort = {
                column: index,
                isAsc: newIsAsc
            };
            
            // Update UI
            headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            this.classList.add(newIsAsc ? 'sort-asc' : 'sort-desc');
            
            // Sort the table
            sortTable(table, index, newIsAsc ? 'asc' : 'desc');
        });
    });
});

// Sort function with better type detection and arrow handling
function sortTable(table, column, direction) {
    const tbody = table.tBodies[0];
    // Get all rows, including hidden ones
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const header = table.rows[0].cells[column];
    const sortType = header.getAttribute('data-sort-type') || 'text';
    
    // Store the current scroll position
    const scrollPosition = window.scrollY;
    
    // Get all rows and sort them
    rows.sort((a, b) => {
        const aCell = a.cells[column];
        const bCell = b.cells[column];
        
        // Get values based on sort type
        let aValue, bValue;
        
        if (sortType === 'number') {
            // Get the raw data-value attribute first
            const aData = aCell.getAttribute('data-value');
            const bData = bCell.getAttribute('data-value');
            
            // Treat null/empty values as Infinity when sorting
            aValue = (aData === null || aData === '') ? 
                (direction === 'asc' ? Infinity : -Infinity) : 
                parseFloat(aData);
                
            bValue = (bData === null || bData === '') ? 
                (direction === 'asc' ? Infinity : -Infinity) : 
                parseFloat(bData);
            
            // Handle any remaining invalid numbers
            if (isNaN(aValue)) aValue = direction === 'asc' ? Infinity : -Infinity;
            if (isNaN(bValue)) bValue = direction === 'asc' ? Infinity : -Infinity;
            
            return direction === 'asc' ? aValue - bValue : bValue - aValue;
        } else {
            // Text sorting
            aValue = (aCell.getAttribute('data-value') || aCell.textContent).trim().toLowerCase();
            bValue = (bCell.getAttribute('data-value') || bCell.textContent).trim().toLowerCase();
            
            return direction === 'asc' 
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
        }
    });
    
    // Clear and rebuild the table
    while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
    }
    
    // Re-append all rows in the new order
    tbody.append(...rows);
    
    // Restore scroll position
    window.scrollTo(0, scrollPosition);
    
    // Dispatch an event to notify about the sort change
    const event = new Event('sortChanged');
    event.sortColumn = column;
    event.sortDirection = direction;
    document.dispatchEvent(event);
}
