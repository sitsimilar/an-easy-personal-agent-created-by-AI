#include <iostream>
#include <vector>
#include <algorithm>
int main(){ std::vector<int> v{3,1,2}; std::sort(v.begin(),v.end()); for(int x:v) std::cout<<x<<" "; return 0; }
